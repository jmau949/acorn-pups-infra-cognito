import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ParameterStoreConfig {
  environment: string;
  stackName: string;
}

/**
 * Helper class to manage Parameter Store parameters for CloudFormation outputs
 */
export class ParameterStoreHelper {
  private scope: Construct;
  private config: ParameterStoreConfig;

  constructor(scope: Construct, config: ParameterStoreConfig) {
    this.scope = scope;
    this.config = config;
  }

  /**
   * Create a CloudFormation output and corresponding Parameter Store parameter
   * @param outputId - Unique identifier for the output within the stack
   * @param value - The value to output and store
   * @param description - Description for both output and parameter
   * @param exportName - Optional export name for cross-stack references
   * @param parameterPath - Optional custom parameter path (defaults to generated path)
   * @returns The created CfnOutput
   */
  public createOutputWithParameter(
    outputId: string,
    value: string,
    description: string,
    exportName?: string,
    parameterPath?: string
  ): cdk.CfnOutput {
    // Generate parameter path if not provided
    const generatedPath = parameterPath || this.generateParameterPath(outputId);

    // Create Parameter Store parameter
    new ssm.StringParameter(this.scope, `${outputId}Parameter`, {
      parameterName: generatedPath,
      stringValue: value,
      description: `[${this.config.stackName}] ${description}`,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*', // Allow any string pattern
    });

    // Create CloudFormation output
    const output = new cdk.CfnOutput(this.scope, outputId, {
      value: value,
      description: description,
      exportName: exportName,
    });

    return output;
  }

  /**
   * Batch create multiple outputs with parameters
   * @param outputs - Array of output configurations
   */
  public createMultipleOutputsWithParameters(
    outputs: Array<{
      outputId: string;
      value: string;
      description: string;
      exportName?: string;
      parameterPath?: string;
    }>
  ): cdk.CfnOutput[] {
    return outputs.map(output => 
      this.createOutputWithParameter(
        output.outputId,
        output.value,
        output.description,
        output.exportName,
        output.parameterPath
      )
    );
  }

  /**
   * Generate standardized parameter path
   * @param outputId - The output identifier
   * @returns Formatted parameter path
   */
  private generateParameterPath(outputId: string): string {
    // Convert PascalCase to kebab-case for parameter names
    const kebabCaseId = outputId
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');

    return `/acorn-pups/${this.config.environment}/cfn-outputs/${this.config.stackName}/${kebabCaseId}`;
  }

  /**
   * Create a parameter for an existing CloudFormation output value
   * @param parameterId - Unique identifier for the parameter
   * @param value - The value to store
   * @param description - Description for the parameter
   * @param parameterPath - Optional custom parameter path
   */
  public createParameter(
    parameterId: string,
    value: string,
    description: string,
    parameterPath?: string
  ): ssm.StringParameter {
    const generatedPath = parameterPath || this.generateParameterPath(parameterId);

    return new ssm.StringParameter(this.scope, `${parameterId}Parameter`, {
      parameterName: generatedPath,
      stringValue: value,
      description: `[${this.config.stackName}] ${description}`,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });
  }

  /**
   * Get the parameter path for a given output ID
   * @param outputId - The output identifier
   * @returns The parameter path
   */
  public getParameterPath(outputId: string): string {
    return this.generateParameterPath(outputId);
  }

  /**
   * Create parameters for Cognito User Pool resources
   * @param userPool - The Cognito User Pool
   * @param environment - Environment name
   */
  public createCognitoUserPoolParameters(
    userPool: any,
    environment: string
  ): void {
    // User Pool ID parameter
    this.createParameter(
      'UserPoolId',
      userPool.userPoolId,
      'ID of the Cognito User Pool',
      `/acorn-pups/${environment}/cognito/user-pool/id`
    );

    // User Pool ARN parameter
    this.createParameter(
      'UserPoolArn',
      userPool.userPoolArn,
      'ARN of the Cognito User Pool',
      `/acorn-pups/${environment}/cognito/user-pool/arn`
    );

    // User Pool Name parameter
    this.createParameter(
      'UserPoolName',
      userPool.userPoolName,
      'Name of the Cognito User Pool',
      `/acorn-pups/${environment}/cognito/user-pool/name`
    );
  }
} 