import { ITelemetryProxy } from "../core/Interfaces";

export class CloudflareTelemetryProxy implements ITelemetryProxy {
    constructor(private telemetryService: any) {}

    public async shouldTriggerSynthesis(tenantId: string): Promise<boolean> {
        // Calls strictly to the TELEMETRY_SERVICE internal binding
        const req = new Request('http://internal/log/trigger-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: tenantId })
        });

        try {
            const res = await this.telemetryService.fetch(req);
            if (res.ok) {
                const data = await res.json();
                return data.shouldTrigger === true;
            }
            console.warn(`[TelemetryProxy] Service returned non-OK status: ${res.status}`);
        } catch (e) {
            console.error(`[TelemetryProxy] Trigger check failed`, e);
        }
        
        // Fail closed to save money unless telemetry proves the user is active/cold
        return false;
    }
}
