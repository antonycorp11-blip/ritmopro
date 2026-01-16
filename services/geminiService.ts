
import { GoogleGenAI } from "@google/genai";
import { ScoreData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function getEducationalFeedback(score: ScoreData, levelName: string) {
  try {
    const earlyHits = score.hits.filter(h => h.diff < -50).length;
    const lateHits = score.hits.filter(h => h.diff > 50).length;
    const tendency = earlyHits > lateHits ? "adiantar o toque" : "atrasar a batida";

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analise rítmica:
      Nível: ${levelName}
      Precisão: ${score.accuracy}%
      Tendência: Estudante costuma ${tendency}.
      Total de notas: ${score.hits.length}
      Dê um conselho técnico de violão curto. Use analogias como 'relaxar o pulso' ou 'respiração'.`,
      config: {
        systemInstruction: "Você é um professor de violão de conservatório, focado em biomecânica e percepção rítmica.",
        temperature: 0.8,
      }
    });

    return response.text || "Mantenha o foco na pulsação interna. O metrônomo é seu guia, não seu mestre.";
  } catch (error) {
    return "Sua constância está melhorando. Foque no relaxamento do braço direito.";
  }
}
