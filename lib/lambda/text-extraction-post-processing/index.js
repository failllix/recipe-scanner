const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {
  TextractClient,
  GetDocumentAnalysisCommand,
} = require("@aws-sdk/client-textract");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const textractClient = new TextractClient();
const s3Client = new S3Client();
const snsClient = new SNSClient();

const { getPostgresClient } = require("dsql-connector");

async function processTextExtractionResult(event) {
  const message = JSON.parse(event["Records"][0]["Sns"]["Message"]);

  const jobId = message.JobId;
  const status = message.Status;

  if (status !== "SUCCEEDED") {
    return;
  }

  let nextToken;
  const blocks = [];
  do {
    const command = new GetDocumentAnalysisCommand({
      JobId: jobId,
      NextToken: nextToken,
    });
    const response = await textractClient.send(command);
    nextToken = response.NextToken;
    blocks.push(...response.Blocks);
  } while (nextToken !== undefined);

  const idToResult = {};

  for (const block of blocks) {
    idToResult[block.Id] = { Text: block.Text, Confidence: block.Confidence };
  }

  const layoutBlocks = blocks.filter((block) =>
    block.BlockType.startsWith("LAYOUT_")
  );

  const layoutElements = [];

  for (const layoutBlock of layoutBlocks) {
    for (const relationship of layoutBlock.Relationships || []) {
      if (relationship.Type === "CHILD") {
        const children = relationship.Ids.map((childId) => idToResult[childId]);
        layoutElements.push({
          BlockType: layoutBlock.BlockType,
          Confidence: layoutBlock.Confidence,
          children,
        });
      }
    }
  }

  const concatenatedTexts = layoutElements.map((layout) => {
    let text = "";
    for (const i in layout.children) {
      const child = layout.children[i];

      const isSeparatedAcrossLines = child.Text.endsWith("-");
      const textToAppend = isSeparatedAcrossLines
        ? child.Text.split("").slice(0, -1).join("")
        : child.Text;

      text += textToAppend;

      if (i < layout.children.length && !isSeparatedAcrossLines) {
        text += " ";
      }
    }

    return `${layout.BlockType.split("LAYOUT_")[1]}: ${text}`;
  });

  console.log(concatenatedTexts);

  const postgresClient = await getPostgresClient();
  await postgresClient.connect();

  const getJobDetailsQuery = {
    text: "SELECT * FROM textract_jobs WHERE job_id = $1",
    values: [jobId],
  };
  const jobDetailsResult = await postgresClient.query(getJobDetailsQuery);
  const { ["recipe_id"]: recipeId, ["file_id"]: fileId } =
    jobDetailsResult.rows[0];

  const saveRawTextractResult = new PutObjectCommand({
    Body: JSON.stringify(blocks),
    Bucket: process.env.S3_BUCKET,
    Key: `${recipeId}/${fileId}-raw.json`,
  });
  await s3Client.send(saveRawTextractResult);

  const savePreparedText = new PutObjectCommand({
    Body: concatenatedTexts.join("\n"),
    Bucket: process.env.S3_BUCKET,
    Key: `${recipeId}/${fileId}.txt`,
  });
  await s3Client.send(savePreparedText);

  const updateJobDetailsQuery = {
    text: "UPDATE textract_jobs SET status = 'PROCESSED' WHERE job_id = $1",
    values: [jobId],
  };
  await postgresClient.query(updateJobDetailsQuery);

  const allRecipeRelatedTextractJobsQuery = {
    text: "SELECT * FROM textract_jobs WHERE recipe_id = $1",
    values: [recipeId],
  };
  const allJobsRelatedToRecipeResult = await postgresClient.query(
    allRecipeRelatedTextractJobsQuery
  );

  const allJobsRelatedToRecipe = allJobsRelatedToRecipeResult.rows;

  if (allJobsRelatedToRecipe.every((job) => job.status === "PROCESSED")) {
    const updateRecipeDetailsQuery = {
      text: "UPDATE recipes SET status = 'SCHEMA_GENERATION' WHERE id = $1",
      values: [recipeId],
    };
    await postgresClient.query(updateRecipeDetailsQuery);

    await snsClient.send(
      new PublishCommand({
        Message: JSON.stringify({ recipeId }),
        TopicArn: process.env.RECIPE_SCHEMA_GENERATION_TOPIC,
      })
    );
  }
}

module.exports = { processTextExtractionResult };
