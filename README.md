# Firebase Phone Authentication with WhatsApp Verification

This project provides a serverless authentication system using Firebase Cloud Functions, allowing users to authenticate using their phone numbers with verification codes sent via WhatsApp.

## Features

- Phone number authentication with WhatsApp verification
- Custom token generation for Firebase Authentication
- User profile creation in Realtime Database
- Scheduled cleanup of expired verification codes
- Secure database rules for user and product data
- Auction functionality with bidding system

## Project Structure

```
├── database.rules.json    # Firebase Realtime Database security rules
├── firebase.json          # Firebase configuration
├── functions/             # Firebase Cloud Functions
│   ├── src/
│   │   └── index.ts       # Main functions code
│   ├── lib/               # Compiled JavaScript
│   ├── package.json       # Dependencies
│   └── tsconfig.json      # TypeScript configuration
└── README.md              # This file
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or later recommended)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A Firebase project with Realtime Database enabled
- A WhatsApp Business API account (for WhatsApp verification)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/firebase-whatsapp-auth.git
   cd firebase-whatsapp-auth
   ```

2. Install dependencies:
   ```bash
   cd functions
   npm install
   ```

3. Log in to Firebase:
   ```bash
   firebase login
   ```

4. Initialize your project:
   ```bash
   firebase use --add
   ```

## Configuration

### WhatsApp Integration

To use WhatsApp for verification codes, you'll need to set up:

1. A WhatsApp Business account
2. Meta for Developers app with WhatsApp integration enabled
3. A message template for verification codes

Configure your WhatsApp API credentials:

```bash
firebase functions:config:set whatsapp.phone_id="YOUR_WHATSAPP_PHONE_ID" \
                             whatsapp.token="YOUR_WHATSAPP_ACCESS_TOKEN" \
                             whatsapp.template_name="YOUR_TEMPLATE_NAME" \
                             whatsapp.language="en"
```

The template should have a parameter placeholder for the verification code.

### Local Development

For local development, create a `.runtimeconfig.json` file in your functions directory:

```json
{
  "whatsapp": {
    "phone_id": "YOUR_WHATSAPP_PHONE_ID",
    "token": "YOUR_WHATSAPP_ACCESS_TOKEN",
    "template_name": "YOUR_TEMPLATE_NAME",
    "language": "en"
  }
}
```

## Running Locally

1. Start the Firebase emulators:
   ```bash
   firebase emulators:start
   ```

2. The functions will be available at:
   - Request verification: http://localhost:5001/{your-project-id}/us-central1/requestVerification
   - Verify code: http://localhost:5001/{your-project-id}/us-central1/verifyCode

## API Reference

### Request Verification Code

**Endpoint**: `/requestVerification`

**Method**: POST

**Body**:
```json
{
  "phoneNumber": "+1234567890"
}
```

**Response**:
```json
{
  "success": true,
  "codeId": "unique-code-id"
}
```

### Verify Code

**Endpoint**: `/verifyCode`

**Method**: POST

**Body**:
```json
{
  "codeId": "unique-code-id",
  "code": "123456",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response**:
```json
{
  "success": true,
  "userId": "firebase-user-id",
  "customToken": "firebase-custom-token",
  "firstName": "John",
  "lastName": "Doe"
}
```

## Database Rules

The project includes security rules for the Realtime Database that:

- Protect user data
- Allow only authenticated users to place bids
- Ensure bid amounts follow minimum increment rules
- Allow admins to manage products

## Deployment

Deploy the functions to Firebase:

```bash
firebase deploy --only functions
```

Deploy database rules:

```bash
firebase deploy --only database
```

## Customization

### Modifying WhatsApp Template

Update the WhatsApp template in the `sendWhatsAppVerificationCode` function:

```typescript
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
  // Add or modify components as needed
]
```

### Changing Verification Expiry Time

Update the expiry time in the `requestVerification` function:

```typescript
expiresAt: Date.now() + (5 * 60 * 1000), // Change 5 to your desired minutes
```

### Adding Additional User Data

Modify the `UserData` interface and the user creation process in the `verifyCode` function.

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.