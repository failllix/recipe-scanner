import path from "path";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";

export class RecipeScannerStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    {
      userPool,
      userPoolClient,
    }: { userPool: cognito.UserPool; userPoolClient: cognito.UserPoolClient },
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const uploadBucket = new s3.Bucket(this, "UploadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const textExtractionFunction = new lambda.Function(
      this,
      "TextExtractionFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "text-extraction.handleTextExtraction",
        code: lambda.Code.fromAsset(path.join(__dirname, "lambda")),
        environment: {
          S3_BUCKET: uploadBucket.bucketName,
        },
        timeout: cdk.Duration.minutes(1),
      }
    );

    uploadBucket.grantRead(textExtractionFunction);

    const authorizer = new HttpUserPoolAuthorizer(
      "RecipeScannerAuthorizer",
      userPool,
      { userPoolClients: [userPoolClient] }
    );

    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      defaultAuthorizer: authorizer,
      createDefaultStage: true,
    });

    const textExtractionFunctionIntegration = new HttpLambdaIntegration(
      "TextExtractionFunctionIntegration",
      textExtractionFunction
    );

    httpApi.addRoutes({
      path: "/text/extract",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: textExtractionFunctionIntegration,
    });

    new cdk.CfnOutput(this, "APIUrl", {
      value: httpApi.url || "",
      description: "URL of the HTTP API gateway",
    });
  }
}
