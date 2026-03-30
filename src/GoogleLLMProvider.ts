/**
 * GoogleLLMProvider
 * 
 * Supports the cf-mcp Triple-Facet Architecture by automatically routing
 * AI generation requests based on environment variables:
 * 
 * 1. Facet A: Standalone Open Source User
 *    Uses raw `GEMINI_API_KEY` for direct AI Studio fetches.
 * 
 * 2. Facet B/C: Managed CR Proxy
 *    Uses `GOOGLE_APPLICATION_CREDENTIALS` (JSON or tokens) for secure Vertex AI calls.
 */

export interface GoogleConfig {
  GEMINI_API_KEY?: string;
  VERTEX_PROJECT_ID?: string;
  VERTEX_REGION?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string; // JSON string in CF Vault for Service Accounts
  DISABLE_PROXY_ENCRYPTION?: string;
}

export class GoogleLLMProvider {
  private config: GoogleConfig;

  constructor(config: GoogleConfig) {
    this.config = config;
  }

  /**
   * Generates a text summary or skill tree node.
   * Dynamically selects the routing path depending on available credentials.
   */
  async generateText(prompt: string): Promise<string> {
    const useVertex = !!this.config.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (useVertex) {
      return this.routeViaVertex(prompt);
    } 
    
    if (this.config.GEMINI_API_KEY) {
      return this.routeViaAIStudio(prompt);
    }

    throw new Error("No Google AI credentials provided. Must set either GEMINI_API_KEY or GOOGLE_APPLICATION_CREDENTIALS.");
  }

  private async routeViaVertex(prompt: string): Promise<string> {
    // 1. Parse service account JSON from GOOGLE_APPLICATION_CREDENTIALS
    // 2. Obtain short-lived JWT/Bearer OAuth2 token
    // 3. Make fetch request to:
    // https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/gemini-1.5-pro:generateContent
    
    // TODO: Implement actual Vertex OAuth2 exchange logic for Cloudflare runtime
    return `[Mock] Vertex AI Output for: ${prompt}`;
  }

  private async routeViaAIStudio(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.config.GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI Studio Error: ${response.status} - ${err}`);
    }

    const data: any = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}
