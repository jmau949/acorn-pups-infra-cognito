# Acorn Pups Cognito Infrastructure

AWS CDK Infrastructure for Acorn Pups Cognito User Pool and authentication resources.

## Overview

This project provides a complete AWS Cognito User Pool setup with:
- 🔐 User Pool with email-based authentication
- 🧠 Post-confirmation Lambda function that creates user records in DynamoDB
- 📤 Parameter Store integration for cross-stack resource sharing
- 🏷️ Comprehensive resource tagging
- 🔧 Environment-specific configurations

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cognito       │    │ Post-Confirmation │    │   DynamoDB      │
│   User Pool     │───▶│     Lambda        │───▶│  Users Table    │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│  Parameter      │    │   CloudWatch     │
│    Store        │    │      Logs        │
└─────────────────┘    └──────────────────┘
```

## Prerequisites

1. **Node.js**: Version 22.0.0 or higher
2. **AWS CDK**: Version 2.100.0 or higher
3. **AWS CLI**: Configured with appropriate credentials
4. **Database Infrastructure**: The `acorn-pups-infra-db` stack must be deployed first

## Dependencies

This stack depends on the following resources from the DB infrastructure:
- Users table name (from Parameter Store)
- Users table ARN (from Parameter Store)

## Installation

1. Clone this repository
2. Install dependencies:
   ```powershell
   npm install
   ```

3. Build the project:
   ```powershell
   npm run build
   ```

## Configuration

### User Pool Settings
- **Name**: `acorn-pups-{environment}-user-pool`
- **Sign-in**: Email only (no username)
- **Auto-verification**: Email enabled
- **Self sign-up**: Enabled
- **MFA**: Disabled
- **Account recovery**: Email only

### Standard Attributes
- **Email**: Required, immutable
- **Name**: Required, mutable

### Password Policy
- Minimum length: 8 characters
- Requires: uppercase, lowercase, numbers
- Symbols: not required
- Temporary password validity: 7 days

### Lambda Function
- **Runtime**: Node.js 18.x
- **Timeout**: 5 seconds
- **Environment**: `USERS_TABLE_NAME` variable
- **Permissions**: 
  - `dynamodb:PutItem` on users table
  - `cloudwatch:PutMetricData` for custom metrics
- **Features**:
  - AWS SDK v3 for improved performance
  - Secure user ID generation using `crypto.randomUUID()`
  - CloudWatch custom metrics for monitoring
  - Pacific timezone default setting

## Deployment

### Development Environment
```powershell
npm run deploy:dev
```

### Production Environment
```powershell
npm run deploy:prod
```

### Synthesize CloudFormation Template
```powershell
npm run synth
```

### View Differences
```powershell
npm run diff:dev
# or
npm run diff:prod
```

## Outputs

The stack exports the following values via Parameter Store and CloudFormation:

### Parameter Store Paths
- `/acorn-pups/{env}/cognito/user-pool/id`
- `/acorn-pups/{env}/cognito/user-pool/arn`
- `/acorn-pups/{env}/cognito/user-pool/name`
- `/acorn-pups/{env}/cognito/post-confirmation-lambda/arn`
- `/acorn-pups/{env}/cognito/post-confirmation-lambda/name`

### CloudFormation Exports
- `acorn-pups-user-pool-id-{env}`
- `acorn-pups-user-pool-arn-{env}`
- `acorn-pups-user-pool-name-{env}`
- `acorn-pups-post-confirmation-lambda-arn-{env}`
- `acorn-pups-post-confirmation-lambda-name-{env}`

## Usage in Other Stacks

### API Gateway Authorizer
```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// Retrieve User Pool ARN from Parameter Store
const userPoolArn = ssm.StringParameter.valueFromLookup(
  this, 
  '/acorn-pups/dev/cognito/user-pool/arn'
);

// Create Cognito authorizer
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
  cognitoUserPools: [cognito.UserPool.fromUserPoolArn(this, 'UserPool', userPoolArn)],
});
```

## Testing

```powershell
npm run test
```

## File Structure

```
acorn-pups-infra-cognito/
├── lib/
│   ├── cognito-stack.ts           # Main Cognito stack
│   ├── types.ts                   # TypeScript interfaces
│   └── parameter-store-helper.ts  # Parameter Store utilities
├── lambda/
│   └── post-confirmation/
│       ├── index.ts               # Lambda function code
│       └── package.json           # Lambda dependencies
├── bin/
│   └── app.ts                     # CDK app entry point
├── test/                          # Test files
├── package.json                   # Project dependencies
├── tsconfig.json                  # TypeScript configuration
├── cdk.json                       # CDK configuration
├── jest.config.js                 # Jest test configuration
└── README.md                      # This file
```

## Post-Confirmation Lambda Function

The Lambda function automatically creates a user record in DynamoDB when a user confirms their email. The user record includes:

- Unique user ID (generated using `crypto.randomUUID()`)
- Email address (from Cognito)
- Cognito subject ID
- Full name (from Cognito attributes)
- Default timezone (Pacific: `America/Los_Angeles`)
- Default settings (notifications, preferences, etc.)
- Timestamps (created_at, updated_at)

### CloudWatch Metrics

The Lambda function publishes custom metrics to CloudWatch for monitoring:

- **Namespace**: `AcornPups/UserRegistration`
- **Metrics**:
  - `UserCreationSuccess` - Incremented when user record is successfully created
  - `UserCreationFailure` - Incremented when user record creation fails

### Performance Improvements

- **AWS SDK v3**: Uses the latest AWS SDK for better performance and smaller bundle size
- **Secure ID Generation**: Uses Node.js `crypto.randomUUID()` for cryptographically secure user IDs
- **Optimized Date Handling**: ISO date string generated once and reused for consistency

## Security

- Lambda function has minimal permissions:
  - `dynamodb:PutItem` on users table only
  - `cloudwatch:PutMetricData` for monitoring metrics
- Secure user ID generation using cryptographically secure `randomUUID()`
- Uses condition expressions to prevent data overwrites
- All resources are tagged for compliance
- Production resources use `RETAIN` removal policy

## Troubleshooting

### Common Issues

1. **Parameter Store Values Not Found**
   - Ensure the DB infrastructure stack is deployed first
   - Check that parameter paths match expected format

2. **Lambda Function Timeout**
   - Check DynamoDB table permissions
   - Verify network connectivity
   - Review CloudWatch logs

3. **User Pool Creation Issues**
   - Verify Lambda function is created successfully
   - Check IAM permissions for Cognito service

### Logs

Lambda function logs are available in CloudWatch:
- Log Group: `/aws/lambda/acorn-pups-{environment}-post-confirmation`

## Contributing

1. Follow the existing code patterns
2. Update tests for any changes
3. Ensure all environments work correctly
4. Update documentation as needed

## License

MIT License - see LICENSE file for details. 