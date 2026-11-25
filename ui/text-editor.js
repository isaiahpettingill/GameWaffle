import {propertyAliases,validateCollections} from '../src/collections.mjs';
import {EditorState} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightActiveLineGutter,drawSelection} from '@codemirror/view';
import {history,historyKeymap,defaultKeymap,indentWithTab} from '@codemirror/commands';
import {linter,lintGutter,lintKeymap,forceLinting} from '@codemirror/lint';
import {StreamLanguage,syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {compileScript} from '../src/script.mjs';
import {parseScript,locations} from '../src/wafflescript.mjs';
import {resourceTables} from '../src/resource-tables.mjs';

const language=StreamLanguage.define({token(stream){
  if(stream.eatSpace())return null;
  if(stream.match(/#.*/))return 'comment';
  if(stream.match(/"(?:\\.|[^"\\])*"?/))return 'string';
  if(stream.match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/))return 'number';
  if(stream.match(/(?:on|clone|end|if|elif|else|while|repeat|change|by|return|break|continue|proc|def|const|use|input|menu|resource|init_properties|property|not|and|or)\b/))return 'keyword';
  if(stream.match(/(?:true|false|none)\b/))return 'atom';
  if(stream.match(/[a-zA-Z_]\w*(?=\s*\()/))return 'variableName.function';
  if(stream.match(/[a-zA-Z_]\w*/))return 'variableName';
  if(stream.match(/[=+/*%<>!-]+/))return 'operator';
  stream.next();return null;
}});
const mochaSyntax=HighlightStyle.define([
  {tag:tags.keyword,color:'#cba6f7'},
  {tag:tags.atom,color:'#f9e2af'},
  {tag:tags.string,color:'#a6e3a1'},
  {tag:tags.number,color:'#fab387'},
  {tag:tags.variableName,color:'#cdd6f4'},
  {tag:tags.function(tags.variableName),color:'#89b4fa'},
  {tag:tags.operator,color:'#89dceb'},
  {tag:tags.comment,color:'#a6adc8',fontStyle:'italic'},
]);
const mochaEditor=EditorView.theme({
  '&':{height:'100%',background:'#1e1e2e',color:'#cdd6f4'},
  '.cm-scroller':{overflow:'auto'},
  '.cm-content':{caretColor:'#f5e0dc'},
  '.cm-cursor, .cm-dropCursor':{borderLeftColor:'#f5e0dc'},
  '.cm-gutters':{backgroundColor:'#181825',color:'#a6adc8',borderRightColor:'#45475a'},
  '.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'#313244'},
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':{backgroundColor:'#45475a'},
  '.cm-tooltip':{backgroundColor:'#181825',color:'#cdd6f4',borderColor:'#45475a'},
  '.cm-lintRange-error':{textDecoration:'underline wavy #f38ba8',backgroundImage:'none'},
},{dark:true});

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
    let references=registry;
    if(registry?.gameScript){
      const {locale,tables}=resourceTables(registry.localization,unit.declarations?.resources);
      references={...registry,collections:validateCollections(unit.collections),
        propertyAliases:propertyAliases(unit.declarations?.globals,unit.declarations?.flags,registry.items),
        controls:{...registry.controls,...unit.declarations?.controls},menus:{...registry.menus,...unit.declarations?.menus},
        events:{...registry.events,...unit.declarations?.events},flags:{...registry.flags,...unit.declarations?.flags},text:tables[locale]??{}};
    }
    compileScript(unit,modules,undefined,references);
  }catch(err){Object.assign(err,locations.get(err.node));throw err;}
  return unit;
}
export function mountText(parent,source,changed,moduleName,registry){
  const view=new EditorView({parent,state:EditorState.create({doc:source,extensions:[
    lineNumbers(),history(),language,syntaxHighlighting(mochaSyntax),mochaEditor,
    highlightActiveLine(),highlightActiveLineGutter(),drawSelection(),lintGutter(),
    keymap.of([indentWithTab,...defaultKeymap,...historyKeymap,...lintKeymap]),EditorView.lineWrapping,
    EditorView.contentAttributes.of({'aria-label':'WaffleScript source',spellcheck:'false'}),
    EditorView.updateListener.of(update=>{if(update.docChanged)changed();}),
    linter(async view=>{
      const doc=view.state.doc;
      try{await validateText(doc.toString(),moduleName,registry());return [];}catch(err){
        const from=Math.min(doc.length,err.from??0);
        return [{from,to:Math.min(doc.length,err.to??doc.lineAt(from).to),severity:'error',message:err.message}];
      }
    })
  ]})});
  forceLinting(view);
  return {source:()=>view.state.doc.toString(),insert:(from,text)=>view.dispatch({changes:{from,insert:text}}),
    replace:source=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:source}}),
    dispose:()=>view.destroy(),focus:()=>view.focus()};
}
