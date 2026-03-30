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

// Helper function to convert Base64 string to ArrayBuffer for WebCrypto
function base64UrlEncode(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function str2ab(pem: string): ArrayBuffer {
    const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                           .replace(/-----END PRIVATE KEY-----/, '')
                           .replace(/\s+/g, '');
    const binary = atob(pemContents);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
    }
    return buffer;
}

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

  private async getAccessToken(serviceAccountJson: string): Promise<string> {
      const credentials = JSON.parse(serviceAccountJson);
      const header = { alg: "RS256", typ: "JWT" };
      const now = Math.floor(Date.now() / 1000);
      const claim = {
          iss: credentials.client_email,
          scope: "https://www.googleapis.com/auth/cloud-platform",
          aud: "https://oauth2.googleapis.com/token",
          exp: now + 3600,
          iat: now
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedClaim = base64UrlEncode(JSON.stringify(claim));
      const payloadToSign = `${encodedHeader}.${encodedClaim}`;

      const privateKeyBuffer = str2ab(credentials.private_key);

      const cryptoKey = await crypto.subtle.importKey(
          "pkcs8",
          privateKeyBuffer,
          { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
          false,
          ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          cryptoKey,
          new TextEncoder().encode(payloadToSign)
      );

      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      const signatureBase64 = base64UrlEncode(String.fromCharCode.apply(null, signatureArray));
      const jwt = `${payloadToSign}.${signatureBase64}`;

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
      });

      if (!tokenResponse.ok) {
          throw new Error(`Failed to exchange JWT for Vertex token: await tokenResponse.text()`);
      }

      const tokenData: any = await tokenResponse.json();
      return tokenData.access_token;
  }

  private async routeViaVertex(prompt: string): Promise<string> {
    if (!this.config.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("Missing Vertex Credentials");
    const projectId = this.config.VERTEX_PROJECT_ID || JSON.parse(this.config.GOOGLE_APPLICATION_CREDENTIALS).project_id;
    const region = this.config.VERTEX_REGION || "us-central1";

    const accessToken = await this.getAccessToken(this.config.GOOGLE_APPLICATION_CREDENTIALS);
    const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-1.5-pro:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: "You are the Omni Librarian, an autonomous semantic synthesis agent. Analyze the following decrypted memories and generate a cohesive conceptual insight that links the ideas together into a unified framework. Respond ONLY with the synthesized structured insight. Do not use conversational filler." }] }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Vertex AI Error: ${response.status} - ${err}`);
    }

    const data: any = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private async routeViaAIStudio(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.config.GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: "You are the Omni Librarian, an autonomous semantic synthesis agent. Analyze the following decrypted memories and generate a cohesive conceptual insight that links the ideas together into a unified framework. Respond ONLY with the synthesized structured insight. Do not use conversational filler." }] }
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
