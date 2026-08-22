"use client";

export type OptionalDetailsValue = {
  informationSensitivity: string;
  preferredLanguage: string;
  existingTools: string;
  providersToAvoid: string;
  expectedOutputs: string;
  commercialUse: boolean;
};

export const defaultOptionalDetails: OptionalDetailsValue = {
  informationSensitivity: "standard",
  preferredLanguage: "English",
  existingTools: "",
  providersToAvoid: "",
  expectedOutputs: "",
  commercialUse: true,
};

export function OptionalDetails({ idPrefix, value, onChange }: { idPrefix: string; value: OptionalDetailsValue; onChange(value: OptionalDetailsValue): void }) {
  function update(patch: Partial<OptionalDetailsValue>) { onChange({ ...value, ...patch }); }
  return <details className="optional-section" open><summary>Recommendation requirements</summary><div className="optional-fields form-grid"><p className="field full hint">Every answer below changes model eligibility, total cost, or ranking. Add as much detail as you can for a more accurate plan.</p><div className="field"><label htmlFor={`${idPrefix}-sensitivity`}>Information sensitivity</label><select id={`${idPrefix}-sensitivity`} value={value.informationSensitivity} onChange={(event) => update({ informationSensitivity: event.target.value })}><option value="standard">Standard work</option><option value="business">Confidential business</option><option value="sensitive">Sensitive information</option><option value="restricted">Restricted or regulated</option></select></div><div className="field"><label htmlFor={`${idPrefix}-language`}>Preferred language</label><input id={`${idPrefix}-language`} value={value.preferredLanguage} onChange={(event) => update({ preferredLanguage: event.target.value })} /></div><div className="field"><label htmlFor={`${idPrefix}-tools`}>Tools already owned</label><input id={`${idPrefix}-tools`} value={value.existingTools} onChange={(event) => update({ existingTools: event.target.value })} placeholder="ChatGPT, Canva" /></div><div className="field"><label htmlFor={`${idPrefix}-providers`}>Providers to avoid</label><input id={`${idPrefix}-providers`} value={value.providersToAvoid} onChange={(event) => update({ providersToAvoid: event.target.value })} placeholder="Comma-separated" /></div><div className="field full"><label htmlFor={`${idPrefix}-outputs`}>Expected output details</label><input id={`${idPrefix}-outputs`} value={value.expectedOutputs} onChange={(event) => update({ expectedOutputs: event.target.value })} placeholder="Quantities, file formats, dimensions, or delivery requirements" /></div><label className="field full checkbox-field"><input type="checkbox" checked={value.commercialUse} onChange={(event) => update({ commercialUse: event.target.checked })} /> Commercial use required</label></div></details>;
}
