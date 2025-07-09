# Parameter Store Outputs

This document describes all Parameter Store values exported by the Cognito infrastructure stack.

## Parameter Store Structure

All parameters follow the naming convention: `/acorn-pups/{environment}/cognito/{resource-type}/{property}`

## Exported Parameters

### User Pool Parameters

#### `/acorn-pups/{environment}/cognito/user-pool/id`
- **Type**: String
- **Description**: Unique identifier for the Cognito User Pool
- **Example**: `us-west-2_AbCdEfGhI`
- **Usage**: Required for API Gateway Cognito authorizers, SDK authentication

#### `/acorn-pups/{environment}/cognito/user-pool/arn`
- **Type**: String
- **Description**: Amazon Resource Name (ARN) of the Cognito User Pool
- **Example**: `arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_AbCdEfGhI`
- **Usage**: IAM policies, cross-service integrations

#### `/acorn-pups/{environment}/cognito/user-pool/name`
- **Type**: String
- **Description**: Human-readable name of the Cognito User Pool
- **Example**: `acorn-pups-dev-user-pool`
- **Usage**: CloudFormation references, debugging

### Lambda Function Parameters

#### `/acorn-pups/{environment}/cognito/post-confirmation-lambda/arn`
- **Type**: String
- **Description**: ARN of the post-confirmation Lambda function
- **Example**: `arn:aws:lambda:us-west-2:123456789012:function:acorn-pups-dev-post-confirmation`
- **Usage**: Cognito User Pool trigger configuration, CloudWatch monitoring

#### `/acorn-pups/{environment}/cognito/post-confirmation-lambda/name`
- **Type**: String
- **Description**: Function name of the post-confirmation Lambda
- **Example**: `acorn-pups-dev-post-confirmation`
- **Usage**: Lambda invocation, CloudWatch logs

#### `/acorn-pups/{environment}/cognito/retry-processor-lambda/arn`
- **Type**: String
- **Description**: ARN of the retry processor Lambda function
- **Example**: `arn:aws:lambda:us-west-2:123456789012:function:acorn-pups-dev-retry-processor`
- **Usage**: SQS trigger configuration, monitoring dashboards

### SQS Queue Parameters

#### `/acorn-pups/{environment}/cognito/primary-retry-queue/url`
- **Type**: String
- **Description**: URL of the primary retry queue for failed user creation attempts
- **Example**: `https://sqs.us-west-2.amazonaws.com/123456789012/acorn-pups-dev-primary-retry`
- **Usage**: Lambda function environment variables, manual queue management

#### `/acorn-pups/{environment}/cognito/manual-intervention-queue/url`
- **Type**: String
- **Description**: URL of the manual intervention queue for persistent failures
- **Example**: `https://sqs.us-west-2.amazonaws.com/123456789012/acorn-pups-dev-manual-intervention`
- **Usage**: Admin tooling, manual processing scripts

### SNS Topic Parameters

#### `/acorn-pups/{environment}/cognito/admin-alert-topic/arn`
- **Type**: String
- **Description**: ARN of the SNS topic for admin alerts and notifications
- **Example**: `arn:aws:sns:us-west-2:123456789012:acorn-pups-dev-admin-alerts`
- **Usage**: CloudWatch alarm actions, manual subscription management

## CloudFormation Exports

In addition to Parameter Store, the stack also exports the following CloudFormation values:

### User Pool Exports
- `acorn-pups-user-pool-id-{environment}`
- `acorn-pups-user-pool-arn-{environment}`
- `acorn-pups-user-pool-name-{environment}`

### Lambda Function Exports
- `acorn-pups-post-confirmation-lambda-arn-{environment}`
- `acorn-pups-post-confirmation-lambda-name-{environment}`
- `acorn-pups-retry-processor-lambda-arn-{environment}`

### Infrastructure Exports
- `acorn-pups-primary-retry-queue-url-{environment}`
- `acorn-pups-manual-intervention-queue-url-{environment}`
- `acorn-pups-admin-alert-topic-arn-{environment}`

## Usage Examples

### TypeScript/CDK Usage

```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// Retrieve User Pool ARN for API Gateway authorizer
const userPoolArn = ssm.StringParameter.valueFromLookup(
  this, 
  '/acorn-pups/dev/cognito/user-pool/arn'
);

const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
  cognitoUserPools: [cognito.UserPool.fromUserPoolArn(this, 'UserPool', userPoolArn)],
});
```

### AWS CLI Usage

```bash
# Get User Pool ID
aws ssm get-parameter --name "/acorn-pups/dev/cognito/user-pool/id" --query 'Parameter.Value' --output text

# Get retry queue URL for monitoring
aws ssm get-parameter --name "/acorn-pups/dev/cognito/primary-retry-queue/url" --query 'Parameter.Value' --output text

# Subscribe to admin alerts
aws sns subscribe \
  --topic-arn "$(aws ssm get-parameter --name "/acorn-pups/dev/cognito/admin-alert-topic/arn" --query 'Parameter.Value' --output text)" \
  --protocol email \
  --notification-endpoint admin@example.com
```

### Node.js/JavaScript Usage

```javascript
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

// Retrieve User Pool configuration
const getUserPoolConfig = async (environment) => {
  const params = [
    `/acorn-pups/${environment}/cognito/user-pool/id`,
    `/acorn-pups/${environment}/cognito/user-pool/arn`,
  ];
  
  const result = await ssm.getParameters({ Names: params }).promise();
  return result.Parameters.reduce((acc, param) => {
    const key = param.Name.split('/').pop();
    acc[key] = param.Value;
    return acc;
  }, {});
};
```

### Python/Boto3 Usage

```python
import boto3

def get_cognito_config(environment):
    ssm = boto3.client('ssm')
    
    parameters = [
        f'/acorn-pups/{environment}/cognito/user-pool/id',
        f'/acorn-pups/{environment}/cognito/user-pool/arn',
        f'/acorn-pups/{environment}/cognito/primary-retry-queue/url',
    ]
    
    response = ssm.get_parameters(Names=parameters)
    return {param['Name'].split('/')[-1]: param['Value'] for param in response['Parameters']}
```

## Monitoring and Troubleshooting

### Queue Monitoring

```bash
# Check primary retry queue depth
aws sqs get-queue-attributes \
  --queue-url "$(aws ssm get-parameter --name "/acorn-pups/dev/cognito/primary-retry-queue/url" --query 'Parameter.Value' --output text)" \
  --attribute-names ApproximateNumberOfMessages

# Check manual intervention queue
aws sqs get-queue-attributes \
  --queue-url "$(aws ssm get-parameter --name "/acorn-pups/dev/cognito/manual-intervention-queue/url" --query 'Parameter.Value' --output text)" \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible
```

### Lambda Function Monitoring

```bash
# View recent post-confirmation Lambda logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/$(aws ssm get-parameter --name "/acorn-pups/dev/cognito/post-confirmation-lambda/name" --query 'Parameter.Value' --output text)" \
  --start-time $(date -d "1 hour ago" +%s)000

# View retry processor Lambda logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/acorn-pups-dev-retry-processor" \
  --start-time $(date -d "1 hour ago" +%s)000
```

## Security Considerations

- All parameters are stored as standard (not secure) string parameters
- No sensitive data (passwords, keys) is stored in Parameter Store
- Parameters are readable by IAM users/roles with `ssm:GetParameter` permissions
- Consider using resource-based policies to restrict access to specific parameters
- Use IAM conditions to restrict access by environment or resource type

## Maintenance

### Parameter Cleanup

When environments are destroyed, the following Parameter Store values should be cleaned up:

```bash
# Delete all Cognito-related parameters for an environment
aws ssm delete-parameters --names \
  "/acorn-pups/dev/cognito/user-pool/id" \
  "/acorn-pups/dev/cognito/user-pool/arn" \
  "/acorn-pups/dev/cognito/user-pool/name" \
  "/acorn-pups/dev/cognito/post-confirmation-lambda/arn" \
  "/acorn-pups/dev/cognito/post-confirmation-lambda/name" \
  "/acorn-pups/dev/cognito/retry-processor-lambda/arn" \
  "/acorn-pups/dev/cognito/primary-retry-queue/url" \
  "/acorn-pups/dev/cognito/manual-intervention-queue/url" \
  "/acorn-pups/dev/cognito/admin-alert-topic/arn"
```

### Parameter Updates

Parameters are automatically updated when the stack is redeployed. Manual updates should be avoided as they will be overwritten on the next deployment.

## Cross-Stack Dependencies

### Required Dependencies

The Cognito stack requires the following parameters from the DB stack:
- `/acorn-pups/{environment}/dynamodb/users-table/name`
- `/acorn-pups/{environment}/dynamodb/users-table/arn`

### Dependent Stacks

The following stacks may depend on these Cognito parameters:
- API Gateway stacks (for authorization)
- Frontend applications (for authentication)
- Admin tooling (for user management)
- Monitoring dashboards (for observability)

## Environment-Specific Considerations

### Development Environment
- Parameters prefixed with `/acorn-pups/dev/cognito/`
- Suitable for testing and development
- May have relaxed security policies

### Production Environment  
- Parameters prefixed with `/acorn-pups/prod/cognito/`
- Enhanced monitoring and alerting
- Stricter security and access controls
- Higher retention periods for queues and logs 