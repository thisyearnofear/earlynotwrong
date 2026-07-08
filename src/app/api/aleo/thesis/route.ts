/**
 * Thesis AI Inference API
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

async function fetchFromModal(prompt: string): Promise<string> {
  const response = await fetch("https://api.us-west-2.modal.direct/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.MODAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "zai-org/GLM-5.1-FP8",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  });

  if (!response.ok) throw new Error("Modal API failed");
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

export async function POST(request: NextRequest) {
  const { intent, metrics } = await request.json();
  const prompt = `
    You are an expert crypto strategist. Help the user draft a professional, concise trade thesis for their Private Strategist commitment.
    User Intent: "${intent}"
    User Conviction Metrics: ${JSON.stringify(metrics)}
    
    Draft a 1-2 sentence thesis that sounds professional. Keep it under 200 characters.
  `;

  try {
    // Try Gemini First
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    return NextResponse.json({ thesis: result.response.text().trim() });
  } catch (geminiError) {
    console.error("Gemini failed, trying Modal fallback:", geminiError);
    try {
      // Fallback to Modal
      const thesis = await fetchFromModal(prompt);
      return NextResponse.json({ thesis });
    } catch (modalError) {
      console.error("Modal fallback failed:", modalError);
      return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
    }
  }
}
