import {EditorState} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine} from '@codemirror/view';
import {history,historyKeymap,defaultKeymap,indentWithTab} from '@codemirror/commands';
import {linter,lintGutter,lintKeymap,forceLinting} from '@codemirror/lint';
import {StreamLanguage,syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import {compileScript} from '../src/script.mjs';
import {parseScript,locations} from '../src/wafflescript.mjs';

const language=StreamLanguage.define({token(stream){
  if(stream.eatSpace())return null;
  if(stream.match(/#.*/))return 'comment';
  if(stream.match(/"(?:\\.|[^"\\])*"?/))return 'string';
  if(stream.match(/\d+(?:\.\d+)?/))return 'number';
  if(stream.match(/(?:on|end|if|else|while|return|proc|def|use|true|false|not|and|or)\b/))return 'keyword';
  if(stream.match(/[a-zA-Z_]\w*/))return 'variableName';
  stream.next();return null;
}});
export async function validateText(source,moduleName,registry){
  const unit=parseScript(source);
  if(moduleName && Object.keys(unit.events).length){
    const from=source.search(/^\s*on\s/m);
    throw Object.assign(Error('Modules can contain procedures and functions only'),{from:Math.max(0,from)});
  }
  let modules={};
  if(unit.imports.length){
    const res=await fetch('./api/modules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imports:unit.imports,moduleName})});
    modules=await res.json();if(!res.ok)throw Error(modules.error);
  }
  try{
    compileScript(unit,modules,undefined,registry);
  }catch(err){Object.assign(err,locations.get(err.node));throw err;}
  return unit;
}
export function mountText(parent,source,changed,moduleName,registry){
  const view=new EditorView({parent,state:EditorState.create({doc:source,extensions:[
    lineNumbers(),history(),language,syntaxHighlighting(defaultHighlightStyle),highlightActiveLine(),lintGutter(),
    keymap.of([indentWithTab,...defaultKeymap,...historyKeymap,...lintKeymap]),EditorView.lineWrapping,
    EditorView.contentAttributes.of({'aria-label':'WaffleScript source',spellcheck:'false'}),
    EditorView.updateListener.of(update=>{if(update.docChanged)changed();}),
    linter(async view=>{
      const doc=view.state.doc;
      try{await validateText(doc.toString(),moduleName,registry);return [];}catch(err){
        const from=Math.min(doc.length,err.from??0);
        return [{from,to:Math.min(doc.length,err.to??doc.lineAt(from).to),severity:'error',message:err.message}];
      }
    }),EditorView.theme({'&':{height:'100%',background:'#242432',color:'#eee'},'.cm-scroller':{overflow:'auto'},'.cm-gutters':{background:'#1b1b26',color:'#bcb8c6'}},{dark:true})
  ]})});
  forceLinting(view);
  return {source:()=>view.state.doc.toString(),dispose:()=>view.destroy(),focus:()=>view.focus()};
}
