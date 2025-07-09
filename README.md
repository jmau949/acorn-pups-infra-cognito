# Acorn Pups Cognito Infrastructure

AWS CDK TypeScript stack for Cognito user authentication infrastructure following the patterns established in the `acorn-pups-infra-db` project.

## Architecture Overview

This stack provides a comprehensive user authentication system with robust failure handling:

### Core Components
- **Cognito User Pool**: Secure user authentication with email verification
- **Post-Confirmation Lambda**: Handles user record creation in DynamoDB
- **Retry Processing System**: Multi-layer failure handling with SQS queues
- **Admin Monitoring**: CloudWatch alarms and SNS notifications

### Failure Handling Architecture

The system implements a multi-layer failure handling strategy that ensures user signups never fail while providing comprehensive retry mechanisms:

```
Cognito User Signup
        ↓
Post-Confirmation Lambda (NEVER FAILS)
        ↓ (on DynamoDB failure)
Primary Retry Queue → Retry Processor Lambda
        ↓ (on continued failure)
Manual Intervention Queue → Admin Review
        ↓ (notifications)
SNS Admin Alerts
```

#### Flow Details

1. **Post-Confirmation Lambda**: 
   - Always returns success to Cognito (user signup proceeds)
   - Attempts DynamoDB user record creation
   - On failure, sends payload to Primary Retry Queue
   - Tracks metrics for all operations

2. **Primary Retry Queue**:
   - Processes failed user creation attempts
   - Exponential backoff delays (30s, 60s, 120s, 300s max)
   - Up to 3 retry attempts per failure
   - Dead letter queue for processing failures

3. **Retry Processor Lambda**:
   - Processes retry queue messages
   - Attempts user record creation with same payload
   - On success: logs recovery and sends admin notification
   - On failure: schedules next retry or escalates to manual intervention

4. **Manual Intervention Queue**:
   - Receives cases that failed all retry attempts
   - Requires admin review and manual processing
   - Triggers immediate admin alerts

5. **Admin Monitoring**:
   - CloudWatch alarms for queue depths and error rates
   - SNS notifications for critical issues
   - Comprehensive metrics tracking

## Project Structure

```
acorn-pups-infra-cognito/
├── bin/
│   └── app.ts                 # CDK app entry point
├── lib/
│   ├── cognito-stack.ts       # Main stack definition
│   ├── types.ts              # TypeScript interfaces
│   └── parameter-store-helper.ts # Parameter store utilities
├── lambda/
│   ├── post-confirmation/     # Post-confirmation trigger
│   │   ├── index.ts
│   │   └── package.json
│   └── retry-processor/       # Retry processing Lambda
│       ├── index.ts
│       └── package.json
├── test/
│   └── cognito-stack.test.ts # Unit tests
├── parameter-store-outputs.md # Parameter store documentation
└── README.md                 # This file
```

## Features

### Cognito User Pool Configuration
- **Authentication**: Email-only sign-in (no username required)
- **Verification**: Email verification enabled for new users
- **MFA**: Disabled by default for simplified user experience
- **Password Policy**: 
  - Minimum 8 characters
  - Requires uppercase, lowercase, and numbers
  - No special characters required
  - Temporary password validity: 7 days

### User Attributes
- **Email**: Required, immutable (used as username)
- **Name**: Required, mutable (user's full name)
- **Phone**: Optional, mutable

### Lambda Functions

#### Post-Confirmation Lambda (`lambda/post-confirmation/index.ts`)
- **Runtime**: Node.js 18.x
- **Timeout**: 5 seconds
- **Failure Strategy**: Never fails Cognito trigger
- **Features**:
  - Cryptographically secure user ID generation (`usr_${randomUUID()}`)
  - AWS SDK v3 with modular imports
  - Comprehensive CloudWatch metrics
  - SQS-based failure handling
  - Pacific timezone default

#### Retry Processor Lambda (`lambda/retry-processor/index.ts`)
- **Runtime**: Node.js 18.x
- **Timeout**: 5 minutes
- **Trigger**: SQS messages from Primary Retry Queue
- **Features**:
  - Exponential backoff retry logic
  - Manual intervention escalation
  - Admin notifications for recoveries
  - Comprehensive error tracking

### Infrastructure Components

#### SQS Queues
- **Primary Retry Queue**: Handles retry attempts with exponential backoff
- **Manual Intervention Queue**: Requires admin review for persistent failures
- **Dead Letter Queues**: Capture processing failures for analysis

#### SNS Topics
- **Admin Alert Topic**: Sends notifications for critical issues and manual interventions

#### CloudWatch Monitoring
- **Metrics**: Custom metrics in `AcornPups/UserRegistration` namespace
- **Alarms**: Queue depth, error rates, and failure patterns
- **Dashboards**: Real-time monitoring of user registration health

## Environment Configuration

The stack supports multiple environments (dev, prod) with environment-specific:
- Resource naming (`acorn-pups-{environment}-*`)
- Parameter store keys (`/acorn-pups/{environment}/cognito/*`)
- Tagging (Environment tag)

## Dependencies

### External Dependencies
- **DynamoDB Table**: Retrieved from parameter store (`/acorn-pups/{environment}/dynamodb/users-table/name`)
- **Table ARN**: Retrieved from parameter store (`/acorn-pups/{environment}/dynamodb/users-table/arn`)

### AWS Services
- AWS Cognito User Pools
- AWS Lambda (Node.js 18.x)
- Amazon DynamoDB
- Amazon SQS
- Amazon SNS
- Amazon CloudWatch
- AWS Systems Manager Parameter Store

## Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Install Lambda Dependencies**:
   ```bash
   # Post-confirmation Lambda
   cd lambda/post-confirmation
   npm install
   
   # Retry processor Lambda
   cd ../retry-processor
   npm install
   ```

3. **Build the Project**:
   ```bash
   npm run build
   ```

4. **Run Tests**:
   ```bash
   npm test
   ```

5. **Deploy Stack**:
   ```bash
   # For development environment
   npm run deploy:dev
   
   # For production environment
   npm run deploy:prod
   ```

## Usage

### Development Workflow
1. Make changes to the code
2. Run tests: `npm test`
3. Build: `npm run build`
4. Deploy: `npm run deploy:dev`

### Monitoring and Troubleshooting

#### CloudWatch Metrics
- `UserCreationSuccess`: Successful user creations
- `UserCreationImmediateFailure`: Initial failures sent to retry queue
- `UserCreationRetrySuccess`: Successful retry attempts
- `UserCreationRetryFailure`: Failed retry attempts
- `UserCreationManualInterventionRequired`: Cases requiring manual review

#### Queue Monitoring
- Monitor Primary Retry Queue depth for processing delays
- Monitor Manual Intervention Queue for cases requiring admin attention
- Review dead letter queues for system issues

#### Admin Alerts
- Subscribe to the Admin Alert SNS topic for critical notifications
- Configure email/SMS endpoints for immediate issue awareness

## Testing

The test suite includes:
- Stack synthesis validation
- Resource creation verification
- Parameter store output validation
- Lambda function configuration testing
- Queue and topic creation validation
- Monitoring alarm configuration testing

Run tests with:
```bash
npm test
```

## Parameter Store Integration

All stack outputs are stored in AWS Systems Manager Parameter Store with consistent naming:
- `/acorn-pups/{environment}/cognito/user-pool/id`
- `/acorn-pups/{environment}/cognito/user-pool/arn`
- `/acorn-pups/{environment}/cognito/user-pool/name`
- `/acorn-pups/{environment}/cognito/primary-retry-queue/url`
- `/acorn-pups/{environment}/cognito/manual-intervention-queue/url`
- `/acorn-pups/{environment}/cognito/admin-alert-topic/arn`

See `parameter-store-outputs.md` for complete parameter documentation.

## Security

- Lambda functions use least-privilege IAM policies
- DynamoDB access limited to specific table and operations
- SQS queues use encryption at rest
- SNS topics require explicit subscription for admin alerts
- CloudWatch metrics don't expose sensitive user data

## Maintenance

### Regular Tasks
- Monitor queue depths and processing times
- Review CloudWatch metrics for unusual patterns
- Process manual intervention queue items
- Update Lambda dependencies periodically

### Scaling Considerations
- Lambda concurrent execution limits
- SQS message retention and throughput
- DynamoDB provisioned capacity
- CloudWatch metric retention

## License

This project is licensed under the MIT License. 