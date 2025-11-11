import path from "path";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";

import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dsql from "aws-cdk-lib/aws-dsql";

export class TextExtractionStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    {
      httpApi,
      uploadBucket,
      recipeDataCluster,
      nodePostgresLayer,
    }: {
      httpApi: apigatewayv2.HttpApi;
      uploadBucket: s3.Bucket;
      recipeDataCluster: dsql.CfnCluster;
      nodePostgresLayer: lambda.LayerVersion;
    },
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const textExtractionResultTopic = new sns.Topic(
      this,
      "TextExtractionResultTopic",
      {
        displayName: "Recipe text extraction post processing topic",
      }
    );

    const textExtractionResultTopicPublishRole = new iam.Role(
      this,
      "TextractGrantPublishResultTopicRole",
      {
        assumedBy: new iam.ServicePrincipal("textract.amazonaws.com"),
      }
    );

    textExtractionResultTopic.grantPublish(
      textExtractionResultTopicPublishRole
    );

    const textExtractionFunction = new lambda.Function(
      this,
      "TextExtractionFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.startTextExtraction",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "text-extraction")
        ),
        environment: {
          S3_BUCKET: uploadBucket.bucketName,
          CLUSTER_ENDPOINT: `${recipeDataCluster.attrIdentifier}.dsql.${props?.env?.region}.on.aws`,
          CLUSTER_REGION: props?.env?.region || "",
          TEXT_EXTRACTION_RESULT_TOPIC_ROLE:
            textExtractionResultTopicPublishRole.roleArn,
          TEXT_EXTRACTION_RESULT_TOPIC: textExtractionResultTopic.topicArn,
        },
        layers: [nodePostgresLayer],
        timeout: cdk.Duration.minutes(1),
      }
    );

    uploadBucket.grantRead(textExtractionFunction);
    textExtractionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dsql:DbConnectAdmin"],
        resources: [recipeDataCluster.attrResourceArn],
      })
    );
    textExtractionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["textract:StartDocumentAnalysis"],
        resources: ["*"],
      })
    );

    const textExtractionFunctionIntegration = new HttpLambdaIntegration(
      "TextExtractionFunctionIntegration",
      textExtractionFunction
    );

    httpApi.addRoutes({
      path: "/extraction/start",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: textExtractionFunctionIntegration,
    });

    const recipeSchemaGenerationTopic = new sns.Topic(
      this,
      "RecipeSchemaGenerationTopic",
      {
        displayName: "Recipe schema generation topic",
      }
    );

    const textExtractionPostProcessingFunction = new lambda.Function(
      this,
      "TextExtractionPostProcessingFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.processTextExtractionResult",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "text-extraction-post-processing")
        ),
        environment: {
          CLUSTER_ENDPOINT: `${recipeDataCluster.attrIdentifier}.dsql.${props?.env?.region}.on.aws`,
          CLUSTER_REGION: props?.env?.region || "",
          S3_BUCKET: uploadBucket.bucketName,
          RECIPE_SCHEMA_GENERATION_TOPIC: recipeSchemaGenerationTopic.topicArn,
        },
        layers: [nodePostgresLayer],
        timeout: cdk.Duration.minutes(1),
      }
    );

    textExtractionResultTopic.addSubscription(
      new subscriptions.LambdaSubscription(textExtractionPostProcessingFunction)
    );
    textExtractionPostProcessingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dsql:DbConnectAdmin"],
        resources: [recipeDataCluster.attrResourceArn],
      })
    );
    textExtractionPostProcessingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["textract:GetDocumentAnalysis"],
        resources: ["*"],
      })
    );
    uploadBucket.grantWrite(textExtractionPostProcessingFunction);
    recipeSchemaGenerationTopic.grantPublish(
      textExtractionPostProcessingFunction
    );

    const inferenceModelId =
      bedrock.FoundationModelIdentifier.AMAZON_NOVA_PRO_V1_0.modelId;

    const inferenceProfileArn = `arn:aws:bedrock:${props?.env?.region}:${
      props?.env?.account
    }:inference-profile/${
      props?.env?.region?.split("-")[0]
    }.${inferenceModelId}`;

    const inferenceProfile = new bedrock.CfnApplicationInferenceProfile(
      this,
      "InferenceProfile",
      {
        inferenceProfileName: "text-extraction-inference-profile",
        modelSource: {
          copyFrom: inferenceProfileArn,
        },
      }
    );

    const recipeSchemaGenerationFunction = new lambda.Function(
      this,
      "RecipeSchemaGenerationFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.generateSchema",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda", "recipe-schema-generation")
        ),
        environment: {
          S3_BUCKET: uploadBucket.bucketName,
          CLUSTER_ENDPOINT: `${recipeDataCluster.attrIdentifier}.dsql.${props?.env?.region}.on.aws`,
          CLUSTER_REGION: props?.env?.region || "",
          MODEL_ID: inferenceProfile.attrInferenceProfileArn,
        },
        timeout: cdk.Duration.minutes(3),
        layers: [nodePostgresLayer],
      }
    );
    recipeSchemaGenerationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );
    recipeSchemaGenerationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dsql:DbConnectAdmin"],
        resources: [recipeDataCluster.attrResourceArn],
      })
    );
    recipeSchemaGenerationTopic.addSubscription(
      new subscriptions.LambdaSubscription(recipeSchemaGenerationFunction)
    );

    uploadBucket.grantReadWrite(recipeSchemaGenerationFunction);
  }
}
