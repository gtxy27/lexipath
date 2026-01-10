export function parseSubtitleEnhanceResponse(responseText: string): {
  line1_final: string;
  line2_final?: string;
  line3_final?: string;
} {
  try {
    let jsonStr = responseText.trim();

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    if (!data.line1_final) {
      throw new Error('Missing required field: line1_final');
    }

    return {
      line1_final: data.line1_final,
      line2_final: data.line2_final,
      line3_final: data.line3_final,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse subtitle enhance response: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

