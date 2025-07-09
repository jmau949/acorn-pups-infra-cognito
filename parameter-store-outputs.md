# Acorn Pups Cognito Infrastructure - Parameter Store Outputs

This document lists all the Parameter Store parameters created by the Cognito stack.

## Parameter Store Path Structure

All parameters follow this pattern:
```
/acorn-pups/{environment}/cognito/{resource-type}/{property}
```

## Development Environment (`dev`)

### User Pool
- `/acorn-pups/dev/cognito/user-pool/id` → `us-east-1_XXXXXXXXX` (User Pool ID)
- `/acorn-pups/dev/cognito/user-pool/arn` → `arn:aws:cognito-idp:region:account:userpool/us-east-1_XXXXXXXXX`
- `/acorn-pups/dev/cognito/user-pool/name` → `acorn-pups-dev-user-pool`

### Post-Confirmation Lambda
- `/acorn-pups/dev/cognito/post-confirmation-lambda/arn` → `arn:aws:lambda:region:account:function:acorn-pups-dev-post-confirmation`
- `/acorn-pups/dev/cognito/post-confirmation-lambda/name` → `acorn-pups-dev-post-confirmation`

## Production Environment (`prod`)

### User Pool
- `/acorn-pups/prod/cognito/user-pool/id` → `us-east-1_XXXXXXXXX` (User Pool ID)
- `/acorn-pups/prod/cognito/user-pool/arn` → `arn:aws:cognito-idp:region:account:userpool/us-east-1_XXXXXXXXX`
- `/acorn-pups/prod/cognito/user-pool/name` → `acorn-pups-prod-user-pool`

### Post-Confirmation Lambda
- `/acorn-pups/prod/cognito/post-confirmation-lambda/arn` → `arn:aws:lambda:region:account:function:acorn-pups-prod-post-confirmation`
- `/acorn-pups/prod/cognito/post-confirmation-lambda/name` → `acorn-pups-prod-post-confirmation`

## CloudFormation Exports

### Development Environment
- `acorn-pups-user-pool-id-dev` → User Pool ID
- `acorn-pups-user-pool-arn-dev` → User Pool ARN
- `acorn-pups-user-pool-name-dev` → User Pool Name
- `acorn-pups-post-confirmation-lambda-arn-dev` → Post-Confirmation Lambda ARN
- `acorn-pups-post-confirmation-lambda-name-dev` → Post-Confirmation Lambda Name

### Production Environment
- `acorn-pups-user-pool-id-prod` → User Pool ID
- `acorn-pups-user-pool-arn-prod` → User Pool ARN
- `acorn-pups-user-pool-name-prod` → User Pool Name
- `acorn-pups-post-confirmation-lambda-arn-prod` → Post-Confirmation Lambda ARN
- `acorn-pups-post-confirmation-lambda-name-prod` → Post-Confirmation Lambda Name

## Usage in Other Stacks

### API Gateway Authorizer
To use the Cognito User Pool as an authorizer in API Gateway:

```typescript
// Retrieve User Pool ARN from Parameter Store
const userPoolArn = ssm.StringParameter.valueFromLookup(this, '/acorn-pups/dev/cognito/user-pool/arn');

// Create Cognito authorizer
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
  cognitoUserPools: [cognito.UserPool.fromUserPoolArn(this, 'UserPool', userPoolArn)],
});
```

### Lambda Functions
To access user pool information in Lambda functions:

```typescript
// Environment variables (automatically set by CDK)
const userPoolId = process.env.USER_POOL_ID;
const userPoolArn = process.env.USER_POOL_ARN;
```

## Required Dependencies

This stack depends on the following parameter store values from the DB infrastructure:
- `/acorn-pups/{environment}/dynamodb-tables/users/name` → Users table name
- `/acorn-pups/{environment}/dynamodb-tables/users/arn` → Users table ARN

## User Pool Configuration

### Sign-in Settings
- **Sign-in aliases**: Email only (no username)
- **Auto-verification**: Email enabled, phone disabled
- **Self sign-up**: Enabled
- **MFA**: Disabled
- **Account recovery**: Email only

### Password Policy
- **Minimum length**: 8 characters
- **Require uppercase**: Yes
- **Require lowercase**: Yes  
- **Require numbers**: Yes
- **Require symbols**: No
- **Temporary password validity**: 7 days

### Standard Attributes
- **Email**: Required, immutable
- **Name**: Required, mutable

### Lambda Triggers
- **Post-confirmation**: Automatically creates user record in DynamoDB users table
  - Uses AWS SDK v3 for improved performance
  - Publishes CloudWatch metrics for monitoring
  - Generates secure user IDs with `crypto.randomUUID()`
  - Sets Pacific timezone as default

## Security Notes

1. The post-confirmation Lambda function only has `dynamodb:PutItem` permission on the users table
2. Lambda function uses condition expressions to prevent overwriting existing records
3. All CloudWatch logs are automatically created with appropriate permissions
4. Production resources use `RETAIN` removal policy for data protection 