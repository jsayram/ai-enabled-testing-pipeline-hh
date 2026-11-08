function validateTag(model: string) {
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(model) || /(?:-|:)cloud(?:$|:)/i.test(model)) {
    throw new Error('Use a local Ollama model tag');
  }
}

export async function identifyLocalModel(model: string, signal?: AbortSignal) {
  validateTag(model);
  const tag = model.includes(':') ? model : model + ':latest';
  const timeout = AbortSignal.timeout(3000);
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
  if (!response.ok) throw new Error('Cannot list local Ollama models');
  const listed = await response.json() as { models?: { name?: string; digest?: string }[] };
  const match = listed.models?.find(item => item.name === tag);
  if (!match?.digest || !/^[a-f0-9]{64}$/.test(match.digest)) throw new Error('Selected model is not installed locally');
  return { tag, digest: match.digest };
}

export async function localJson(model: string, system: string, payload: unknown, schema: object, seed = 0, temperature = 0, signal?: AbortSignal) {
  validateTag(model);
  const timeout = AbortSignal.timeout(45000);
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error',
    body: JSON.stringify({
      model, stream: false, format: schema, think: false,
      options: { seed, temperature, num_predict: 350 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
    }),
  });
  if (!response.ok) throw new Error('Local Ollama returned HTTP ' + response.status);
  const envelope = await response.json() as { message?: { content?: unknown } };
  if (typeof envelope.message?.content !== 'string' || envelope.message.content.length > 8000) {
    throw new Error('Invalid model response envelope');
  }
  return JSON.parse(envelope.message.content) as unknown;
}
