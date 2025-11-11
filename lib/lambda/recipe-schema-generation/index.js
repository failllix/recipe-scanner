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
  jobsOfRecipeResult.rows.sort((a, b) => a.position - b.position);
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

  const saveAllTexts = new PutObjectCommand({
    Body: recipeTexts.join("\n\n"),
    Bucket: process.env.S3_BUCKET,
    Key: `${recipeId}/all-texts.txt`,
  });
  await s3Client.send(saveAllTexts);

  const converseCommand = new ConverseCommand({
    modelId: process.env.MODEL_ID,
    system: [
      {
        text: "You are a helpful expert in putting texts of a recipe into a common JSON schema.",
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            text: `I extracted the following texts of a recipe from one of my favorite cooking books.
                    Please help me to create a digital copy in a common schema.
                    Language used in the recipe: ${language}.
                    
                    ${recipeTexts.join("\n\n")}`,
          },
        ],
      },
    ],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: "generate_recipe_schema",
            description: "Return a cooking recipe in a common schema",
            inputSchema: {
              json: {
                type: "object",
                properties: {
                  cookTime: {
                    type: "string",
                    description:
                      "The time it takes to actually cook the dish, in ISO 8601 duration format.",
                  },
                  cookingMethod: {
                    type: "string",
                    description:
                      "The method of cooking, such as Frying, Steaming, ...",
                  },
                  recipeCategory: {
                    type: "string",
                    description:
                      "The category of the recipe. For example, appetizer, entree, etc.",
                  },
                  recipeCuisine: {
                    type: "string",
                    description:
                      "The cuisine of the recipe (for example, French or Ethiopian).",
                  },
                  recipeIngredient: {
                    type: "array",
                    description:
                      "An unordered list of ingredients used in the recipe.",
                    items: {
                      type: "object",
                      properties: {
                        value: {
                          type: "string",
                          description: "The amount of the ingredient",
                        },
                        unitText: {
                          type: "string",
                          description:
                            "Text indicating the unit of measurement. For example grams, cups, pieces, ...",
                        },
                        name: {
                          type: "string",
                          description: "The name of the ingredient",
                        },
                      },
                      required: ["value", "name", "unitText"],
                    },
                  },
                  recipeInstructions: {
                    type: "object",
                    description: "An ordered list with How to step items.",
                    properties: {
                      itemListElement: {
                        type: "array",
                        description: "Instruction step of the recipe",
                        items: {
                          type: "string",
                        },
                      },
                      itemListOrder: {
                        type: "string",
                        enum: ["ItemListOrderAscending"],
                        description: "Type of ordering",
                      },
                    },
                    required: ["itemListElement", "itemListOrder"],
                  },
                  recipeYield: {
                    type: "string",
                    description:
                      "The quantity produced by the recipe (for example, number of people served, number of servings, etc).",
                  },
                  suitableForDiet: {
                    type: "array",
                    items: {
                      enum: [
                        "DiabeticDiet",
                        "GlutenFreeDiet",
                        "HalalDiet",
                        "HinduDiet",
                        "KosherDiet",
                        "LowCalorieDiet",
                        "LowFatDiet",
                        "LowLactoseDiet",
                        "LowSaltDiet",
                      ],
                      type: "string",
                    },
                  },
                  name: {
                    type: "string",
                    description: "The name of the recipe.",
                  },
                  description: {
                    type: "string",
                    description: "A description of the recipe.",
                  },
                },
                required: ["recipeIngredient", "recipeInstructions", "name"],
              },
            },
          },
        },
      ],
      toolChoice: {
        tool: {
          name: "generate_recipe_schema",
        },
      },
    },
  });
  const response = await bedrockClient.send(converseCommand);

  const recipeSchema = response.output.message.content[0].toolUse.input;

  const saveJSONSchema = new PutObjectCommand({
    Body: JSON.stringify(recipeSchema),
    Bucket: process.env.S3_BUCKET,
    Key: `${recipeId}/schema.json`,
  });
  await s3Client.send(saveJSONSchema);

  const markRecipeAsDoneQuery = {
    text: "UPDATE recipes SET status = 'FINISHED' WHERE id = $1",
    values: [recipeId],
  };
  await postgresClient.query(markRecipeAsDoneQuery);
}

module.exports = { generateSchema };
