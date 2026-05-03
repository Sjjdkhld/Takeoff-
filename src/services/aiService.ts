import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface DetectedWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export async function detectWallsFromImage(base64Image: string, mimeType: string): Promise<DetectedWall[]> {
  const prompt = `Analyze this floor plan blueprint image and detect all structural walls. 
Identify all wall segments in this architectural blueprint. 
Look for parallel lines that represent the inner and outer faces of walls. 
For each segment, determine its center line and the distance between the parallel lines (thickness).

Return the data as a JSON array of objects. Each object must have:
- "x1", "y1", "x2", "y2": Normalized coordinates (0 to 1000) of the wall's center axis.
- "thickness": Normalized thickness (0 to 1000) representing the distance between faces.

Guidelines:
1. Prioritize continuous long wall segments.
2. Ensure wall junctions are accounted for.
3. Be highly precise with the "thickness" value. Standard walls are usually 9" (approx. 0.23m) or 4.5" (approx. 0.115m).
4. Output ONLY the raw JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              x1: { type: Type.NUMBER },
              y1: { type: Type.NUMBER },
              x2: { type: Type.NUMBER },
              y2: { type: Type.NUMBER },
              thickness: { type: Type.NUMBER },
            },
            required: ["x1", "y1", "x2", "y2", "thickness"],
          },
        },
      },
    });

    if (!response.text) {
      throw new Error("No response text from AI");
    }

    const walls: DetectedWall[] = JSON.parse(response.text.trim());
    return walls;
  } catch (error) {
    console.error("AI Wall Detection Error:", error);
    throw error;
  }
}
