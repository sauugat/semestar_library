'use strict';

// Mask quoted examples/code so mentioning a phrase does not change preferences.
function modeCommandText(message) {
  return String(message || '').replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|(?<!\w)'[^'\n]*'(?!\w)/g, match=>' '.repeat(match.length));
}
function resolveChatMode(message, currentMode='roast') {
  const original=String(message || '');
  const text=modeCommandText(original);
  const commands=/\b(?:(?:please|can you|could you|switch to)\s+)?(be formal|formal mode|formal tone|stop roasting(?: me)?|stop (?:the )?jokes|serious mode|be serious|no jokes|no roasting|no roasts|no banter|don'?t roast me|back to normal|roast me again|back to roast mode|roast mode|back to bestie mode)\b/gi;
  let mode=currentMode==='formal'?'formal':'roast';
  let match;const spans=[];
  while((match=commands.exec(text))) {
    mode=/back to|roast me again|^roast mode$/i.test(match[1])?'roast':'formal';
    spans.push([match.index,commands.lastIndex]);
  }
  let query=original;
  for(const [start,end] of spans.reverse()) query=query.slice(0,start)+query.slice(end);
  query=query.replace(/^[\s,;.!?—:-]*(?:and\s+)?/i,'').replace(/[\s,;.!?—:-]+$/,'').trim().replace(/^(?:please|thanks|thank you)$/i,'');
  return {mode,requested:spans.length>0,query:spans.length?query:original};
}
module.exports={resolveChatMode};
