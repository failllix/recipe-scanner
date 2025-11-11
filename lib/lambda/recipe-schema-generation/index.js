const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const { getPostgresClient } = require("dsql-connector");

const s3Client = new S3Client();
const bedrockClient = new BedrockRuntimeClient();

async function generateSchema(event) {
  const message = JSON.parse(event["Records"][0]["Sns"]["Message"]);

  const { recipeId } = message;

  const postgresClient = await getPostgresClient();
  await postgresClient.connect();

  const getRecipeDetailsQuery = {
    text: "SELECT * FROM recipes WHERE id = $1",
    values: [recipeId],
  };
  const recipeDetailsResult = await postgresClient.query(getRecipeDetailsQuery);

  const { language } = recipeDetailsResult.rows[0];

  const getJobsOfRecipe = {
    text: "SELECT * FROM textract_jobs WHERE recipe_id = $1",
    values: [recipeId],
  };
  const jobsOfRecipeResult = await postgresClient.query(getJobsOfRecipe);
  const files = jobsOfRecipeResult.rows.map((row) => row.file_id);

  const recipeTexts = [];
  for (const file of files) {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `${recipeId}/${file}.txt`,
      })
    );
    const text = await response.Body.transformToString();
    recipeTexts.push(text);
  }

  const converseCommand = new ConverseCommand({
    modelId: process.env.MODEL_ID,
    system: [
      {
        text: `You are a helpful extraction expert specialized in extracting information from cooking books. 
            You do not try to make up new words or try to correct anything in the provided texts.

            You use Markdown for formatting.
            You always make sure to use bulleted lists for ingredients and enumerated lists for instructions.
            For any other texts paragraphs are used.
            Your heading levels always start at 1 and are structured meaningfully.

            You are typically looking for the following information:
            - title
            - category
            - cuisine
            - cooking duration
            - ingredients
            - instructions
            - notes

            If any of those information is not given, don't worry just omit such fields.

            Make sure to not include any page numbers.

            Always in answer in the language of the recipe.`,
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            text: `I extracted the text of a recipe from one of my favorite cooking books.
                    Please help me to create a digital Markdown replica.
                    Language used in the recipe: ${language}.
                    
                    ${recipeTexts.join("\n\n")}`,
          },
        ],
      },
    ],
  });
  const response = await bedrockClient.send(converseCommand);

  const markdownSummary = response.output.message.content[0].text;

  const saveMarkdownSummary = new PutObjectCommand({
    Body: markdownSummary,
    Bucket: process.env.S3_BUCKET,
    Key: `${recipeId}/SUMMARY.md`,
  });
  await s3Client.send(saveMarkdownSummary);

  const updateRecipeStausToSummaryCreatedQuery = {
    text: "UPDATE recipes SET status = 'SUMMARY_CREATED' WHERE id = $1",
    values: [recipeId],
  };
  await postgresClient.query(updateRecipeStausToSummaryCreatedQuery);

  const markRecipeAsDoneQuery = {
    text: "UPDATE recipes SET status = 'FINISHED' WHERE id = $1",
    values: [recipeId],
  };
  await postgresClient.query(markRecipeAsDoneQuery);
}

module.exports = { generateSchema };
