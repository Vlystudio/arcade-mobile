const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cors = {handleCorsPreflight:()=>false,applyCors(){},rejectDisallowedOrigin:()=>null,handleCors:()=>null,corsHeaders:()=>({})};
function load(file, mocks={}, globals={}) {
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>id in mocks?mocks[id]:require(id),
 console:{log(){},warn(){},error(){}},Buffer,URL,Request,Response,AbortSignal,Uint8Array,TextEncoder,setTimeout,clearTimeout,
 process:{env:{}},...globals},{filename:file});
 return mod.exports;
}
const response=()=>({statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(b){this.body=b;return this},end(s){this.body=JSON.parse(s)}});
module.exports={root,load,response,cors};
