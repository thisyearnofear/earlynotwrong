/**
 * Thesis AI Inference API
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    const { intent, metrics } = await request.json();

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
      You are an expert crypto strategist. Help the user draft a professional, concise trade thesis for their Private Strategist commitment.
      User Intent: "${intent}"
      User Conviction Metrics: ${JSON.stringify(metrics)}
      
      Draft a 1-2 sentence thesis that sounds professional. Keep it under 200 characters.
    `;

    const result = await model.generateContent(prompt);
    const thesis = result.response.text().trim();

    return NextResponse.json({ thesis });
  } catch (error) {
    console.error("AI Thesis Error:", error);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
