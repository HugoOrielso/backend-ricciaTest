import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import axios from "axios";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*" }));

app.get("/", (req, res) => {
  res.status(200).json({ message: "on vercel" });
});

app.post("/api/subscribe", async (req, res) => {
  try {
    const { email, name, phone } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const headers = {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
      revision: "2026-04-15",
    };

    const searchResponse = await axios.get(
      `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${email}")`,
      { headers }
    );

    const existingProfile = searchResponse.data?.data?.[0];

    if (!existingProfile?.id) {
      await axios.post(
        "https://a.klaviyo.com/api/profiles/",
        {
          data: {
            type: "profile",
            attributes: {
              email,
              first_name: name || undefined,
              phone_number: phone || undefined,
            },
          },
        },
        { headers }
      );
    }

    const subscribeResponse = await axios.post(
      "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs",
      {
        data: {
          type: "profile-subscription-bulk-create-job",
          attributes: {
            profiles: {
              data: [
                {
                  type: "profile",
                  attributes: {
                    email,
                    subscriptions: {
                      email: {
                        marketing: {
                          consent: "SUBSCRIBED",
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          relationships: {
            list: {
              data: {
                type: "list",
                id: process.env.KLAVIYO_LIST_ID,
              },
            },
          },
        },
      },
      { headers }
    );

    return res.status(200).json({
      success: true,
      message: existingProfile?.id
        ? "Existing user subscribed to list successfully"
        : "New user created and subscribed to list successfully",
      data: subscribeResponse.data,
    });
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.errors?.[0]?.detail ||
        "Internal server error",
      error: error?.response?.data || error.message,
    });
  }
});

export default app;