const MODEL = 'gemini-3.8-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function createGeminiAssistant() {
  let apiKey = '';

  function setApiKey(value) {
    const key = String(value || '').trim();
    if (!key) throw new Error('Enter a Gemini API key.');
    apiKey = key;
  }

  function hasApiKey() {
    return apiKey.length > 0;
  }

  function clearApiKey() {
    apiKey = '';
  }

  async function generateContent(prompt, tools = [], functionCallingMode = 'AUTO') {
    if (!apiKey) throw new Error('Set your Gemini API key first.');
    const request = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    if (tools.length) {
      request.tools = [{ functionDeclarations: tools }];
      request.toolConfig = { functionCallingConfig: { mode: functionCallingMode } };
    }

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(request)
      });
    } catch (error) {
      throw new Error(`Could not reach Gemini: ${error.message}`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Gemini returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = result.error?.message || response.statusText;
      throw new Error(`Gemini request failed (HTTP ${response.status}): ${message}`);
    }

    const parts = result.candidates?.[0]?.content?.parts || [];
    const functionCall = parts.find(part => part.functionCall)?.functionCall || null;
    const text = parts.filter(part => typeof part.text === 'string').map(part => part.text).join('\n').trim();
    if (!functionCall && !text) throw new Error('Gemini returned no usable answer.');
    return { functionCall, text };
  }

  return { setApiKey, clearApiKey, hasApiKey, generateContent };
}
