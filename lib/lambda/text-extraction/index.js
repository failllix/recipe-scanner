const { S3Client, paginateListObjectsV2 } = require("@aws-sdk/client-s3");
const {
  TextractClient,
  StartDocumentAnalysisCommand,
} = require("@aws-sdk/client-textract");

const { getPostgresClient } = require("dsql-connector");

const s3Client = new S3Client();
const textractClient = new TextractClient({
  maxAttempts: 5,
});

async function startTextExtraction(event) {
  try {
    const body = JSON.parse(event.body);

    const folder = body.folder.endsWith("/") ? body.folder : body.folder + "/";
    const language = body.language;
    const name = body.name;

    const paginator = paginateListObjectsV2(
      { client: s3Client, pageSize: 10 },
      { Bucket: process.env.S3_BUCKET, Prefix: folder }
    );

    const files = [];
    for await (const page of paginator) {
      const images =
        page.Contents?.map((object) => object.Key).filter((key) =>
          key.endsWith("jpg")
        ) || [];
      files.push(...images);
    }

    console.log(`Found files for folder "${folder}": ${files}`);

    if (files.length === 0) {
      return {
        statusCode: 404,
      };
    }

    const postgresClient = await getPostgresClient();
    await postgresClient.connect();

    const recipeCreationQuery = {
      text: "INSERT INTO recipes(name, language, status) VALUES($1, $2, 'INITIAL') RETURNING *",
      values: [name, language],
    };

    const recipeCreationResult = await postgresClient.query(
      recipeCreationQuery
    );
    const createdRecipeRow = recipeCreationResult.rows[0];

    const recipeId = createdRecipeRow.id;

    for (const index in files) {
      const file = files[index];
      const input = {
        DocumentLocation: {
          S3Object: {
            Bucket: process.env.S3_BUCKET,
            Name: file,
          },
        },
        FeatureTypes: ["LAYOUT"],
        NotificationChannel: {
          SNSTopicArn: process.env.TEXT_EXTRACTION_RESULT_TOPIC,
          RoleArn: process.env.TEXT_EXTRACTION_RESULT_TOPIC_ROLE,
        },
      };
      const command = new StartDocumentAnalysisCommand(input);
      const response = await textractClient.send(command);

      console.log(`Textract Job id for file ${file} is ${response.JobId}`);

      const textractJobCreationQuery = {
        text: "INSERT INTO textract_jobs(job_id, recipe_id, file_id, position, status) VALUES($1, $2, $3, $4, 'IN_PROGRESS')",
        values: [
          response.JobId,
          recipeId,
          file.split("/").at(-1).split(".").slice(0, -1).join("."),
          index,
        ],
      };
      await postgresClient.query(textractJobCreationQuery);
    }

    const recipeUpdateQuery = {
      text: "UPDATE recipes SET status = 'TEXT_EXTRACTION' WHERE id = $1",
      values: [recipeId],
    };

    await postgresClient.query(recipeUpdateQuery);

    return {
      statusCode: 202,
      body: JSON.stringify({
        id: recipeId,
        status: "TEXT_EXTRACTION",
      }),
    };
  } catch (err) {
    console.log(err);
    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
}

module.exports = { startTextExtraction };
