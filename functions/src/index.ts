import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import axios from "axios";
import cors from "cors";
import {onSchedule} from "firebase-functions/v2/scheduler";

// Initialize Firebase Admin SDK
admin.initializeApp();

// Connect to the Realtime Database emulator when running locally
if (process.env.FUNCTIONS_EMULATOR) {
  // Point to the RTDB emulator running on localhost
  admin.database().useEmulator("localhost", 9000);
}

// Use Realtime Database instead of Firestore
const db = admin.database();
const codesRef = db.ref("verificationCodes");
const usersRef = db.ref("users");

// Update the interface to match Realtime Database structure
interface VerificationData {
  phoneNumber: string;
  code: string;
  expiresAt: number; // Use timestamps as numbers
  createdAt: number; // Use timestamps as numbers
}

// User data interface for Realtime Database
interface UserData {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  uid: string;
  role: string;
  createdAt: number;
}

// Define types for function responses
interface SuccessResponse {
  success: true;
  codeId?: string;
  userId?: string;
  customToken?: string;
  firstName?: string;
  lastName?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}

// CORS middleware
const corsHandler = cors({origin: true});

/**
 * Formats phone number to E.164 standard
 * @param {string} phoneNumber - The phone number to format
 * @return {string} - Formatted phone number
 */
function formatPhoneNumber(phoneNumber: string): string {
  // Remove any non-digit characters
  const digits = phoneNumber.replace(/\D/g, "");

  // Ensure the phone number starts with a plus sign
  if (digits.startsWith("1")) {
    return `+${digits}`;
  } else if (digits.startsWith("0")) {
    // If it starts with 0, assume it's a country code without the + sign
    return `+${digits.substring(1)}`;
  } else if (!phoneNumber.startsWith("+")) {
    return `+${digits}`;
  }

  return phoneNumber;
}

/**
 * Request a verification code via WhatsApp
 */
export const requestVerification = functions.https.onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      // Only allow POST requests
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          error: "Method not allowed",
        } as ErrorResponse);
      }

      const {phoneNumber} = req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required",
        } as ErrorResponse);
      }

      // Format phone number to ensure E.164 compliance
      const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

      // Generate a 6-digit verification code
      const verificationCode = Math.floor(
        100000 + Math.random() * 900000
      ).toString();

      // Create a unique ID for this verification attempt
      const codeId = codesRef.push().key;

      // Store in Realtime Database with expiration time (5 minutes from now)
      const verificationData: VerificationData = {
        phoneNumber: formattedPhoneNumber,
        code: verificationCode,
        expiresAt: Date.now() + (5 * 60 * 1000), // 5 minutes from now
        createdAt: Date.now(),
      };

      // Debug logs to help identify issues
      console.log("Request payload:", req.body);
      console.log("Formatted phone number:", formattedPhoneNumber);
      console.log("Generated code:", verificationCode);
      console.log("Verification data:", verificationData);

      // First store the code
      await codesRef.child(codeId as string).set(verificationData);

      try {
        // Then try to send WhatsApp message - isolate this try/catch
        await sendWhatsAppVerificationCode(
          formattedPhoneNumber,
          verificationCode,
        );
      } catch (whatsappError) {
        console.error("WhatsApp API error:", whatsappError);
        // Continue despite WhatsApp error - user can still verify via code ID
      }

      return res.status(200).json({
        success: true,
        codeId,
      } as SuccessResponse);
    } catch (error) {
      console.error("Error sending verification code:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to send verification code",
        details: process.env.NODE_ENV === "development" ?
          (error as Error).message : undefined,
      } as ErrorResponse);
    }
  });
});

/**
 * Verify code and create Firebase user
 */
export const verifyCode = functions.https.onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      // Only allow POST requests
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          error: "Method not allowed",
        } as ErrorResponse);
      }

      const {codeId, code, firstName, lastName} = req.body;

      if (!codeId || !code) {
        return res.status(400).json({
          success: false,
          error: "Code ID and verification code are required",
        } as ErrorResponse);
      }

      if (!firstName || !lastName) {
        return res.status(400).json({
          success: false,
          error: "First name and last name are required",
        } as ErrorResponse);
      }

      // Get verification data from Realtime Database
      const verificationSnap = await codesRef.child(codeId).once("value");

      if (!verificationSnap.exists()) {
        return res.status(400).json({
          success: false,
          error: "Verification code not found",
        } as ErrorResponse);
      }

      const verificationData = verificationSnap.val() as VerificationData;

      // Check if code has expired
      const now = Date.now();
      if (verificationData.expiresAt < now) {
        // Delete expired code
        await codesRef.child(codeId).remove();
        return res.status(400).json({
          success: false,
          error: "Verification code has expired",
        } as ErrorResponse);
      }

      // Check if the provided code matches
      if (verificationData.code !== code) {
        return res.status(400).json({
          success: false,
          error: "Incorrect verification code",
        } as ErrorResponse);
      }

      // Code is valid, create or update Firebase user
      let userRecord: admin.auth.UserRecord;
      const displayName = `${firstName} ${lastName}`;

      try {
        // Try to find existing user with the phone number
        userRecord = await admin.auth()
          .getUserByPhoneNumber(verificationData.phoneNumber);

        // Update user if found
        await admin.auth().updateUser(userRecord.uid, {
          displayName,
        });

        // Update user data in Realtime Database
        await usersRef.child(userRecord.uid).update({
          firstName,
          lastName,
          displayName,
        });
      } catch (error) {
        // User not found, create a new one
        const errorCode = (error as Record<string, unknown>).code;
        if (errorCode === "auth/user-not-found" ||
            errorCode === "auth/invalid-phone-number") {
          // Create user with phone number
          userRecord = await admin.auth().createUser({
            displayName,
            phoneNumber: verificationData.phoneNumber,
          });

          // Save user data in Realtime Database
          const userData: UserData = {
            firstName,
            lastName,
            phoneNumber: verificationData.phoneNumber,
            uid: userRecord.uid,
            role: "user",
            createdAt: Date.now(),
          };

          await usersRef.child(userRecord.uid).set(userData);
        } else {
          throw error;
        }
      }

      // Delete the used verification code
      await codesRef.child(codeId).remove();

      // Create a custom token for the user
      const customToken = await admin.auth().createCustomToken(userRecord.uid);

      return res.status(200).json({
        success: true,
        userId: userRecord.uid,
        customToken,
        firstName,
        lastName,
      } as SuccessResponse);
    } catch (error) {
      console.error("Error verifying code or creating user:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to verify code or create user",
        details: process.env.NODE_ENV === "development" ?
          (error as Error).message : undefined,
      } as ErrorResponse);
    }
  });
});

/**
 * Helper function to send WhatsApp verification message
 * @param {string} phoneNumber - The phone number to send the code to
 * @param {string} code - The verification code to send
 * @return {Promise<boolean>} - Whether the message was sent successfully
 */
async function sendWhatsAppVerificationCode(
  phoneNumber: string,
  code: string
): Promise<boolean> {
  try {
    // Add debug logging
    console.log("Attempting to send WhatsApp verification to:", phoneNumber);

    // Check if configs exist
    console.log("WhatsApp config:", {
      phone_id: functions.config().whatsapp?.phone_id || "NOT_SET",
      template_name: functions.config().whatsapp?.template_name ||
        "verification",
      language: functions.config().whatsapp?.language || "en",
    });

    // Add fallback defaults for local testing
    const phoneId = functions.config().whatsapp?.phone_id || "TEST_PHONE_ID";
    const accessToken = functions.config().whatsapp?.token || "TEST_TOKEN";
    const templateName = functions.config().whatsapp?.template_name ||
      "verification";
    const language = functions.config().whatsapp?.language || "en";

    // Only attempt API call if we have proper config
    if (phoneId === "TEST_PHONE_ID" || accessToken === "TEST_TOKEN") {
      console.log("[LOCAL DEV] Skipping WhatsApp API call, using mock success");
      return true;
    }

    // Rest of your WhatsApp integration...
    const whatsappApiUrl =
      `https://graph.facebook.com/v17.0/${phoneId}/messages`;

    // Send message using WhatsApp template
    await axios.post(
      whatsappApiUrl,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phoneNumber,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: language,
          },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: code,
                },
              ],
            },
            {
              "type": "button",
              "sub_type": "url",
              "index": 0,
              "parameters": [
                {
                  "type": "text",
                  "text": code,
                },
              ],
            },
          ],
        },
      },
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`Verification code sent to ${phoneNumber} via WhatsApp`);
    return true;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    // Return false instead of throwing, let calling code decide how to handle
    return false;
  }
}

// Scheduled function to clean up expired verification codes
export const cleanupExpiredCodes = onSchedule(
  {schedule: "every 24 hours"},
  async () => {
    const now = Date.now();
    const expiredCodesSnap = await codesRef.orderByChild("expiresAt")
      .endAt(now)
      .once("value");

    // No batching needed in Realtime Database
    const updates: {[key: string]: null} = {};
    expiredCodesSnap.forEach((childSnap) => {
      updates[childSnap.key as string] = null;
    });

    if (Object.keys(updates).length > 0) {
      await codesRef.update(updates);
      console.log(
        `Cleaned up ${Object.keys(updates).length} expired verification codes`
      );
    }
  }
);
