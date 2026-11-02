// Resolve the browser import map for CPU-only scene construction tests.
export async function resolve(specifier,context,nextResolve){
 const aliases={'three':'../vendor/three.webgpu.js','three/webgpu':'../vendor/three.webgpu.js','three/tsl':'../vendor/three.tsl.js'};
 if(aliases[specifier])return {url:new URL(aliases[specifier],import.meta.url).href,shortCircuit:true};
 return nextResolve(specifier,context);
}
