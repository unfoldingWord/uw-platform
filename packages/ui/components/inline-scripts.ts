export const THEME_KEY = 'uw-theme';

export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export const themeSwitchScript = `(function(){var root=document.documentElement;var key='${THEME_KEY}';var stored=null;try{stored=localStorage.getItem(key);}catch(e){}var form=document.getElementById('uw-theme-switch');if(!form){return;}var pick=form.querySelector('input[value="'+(stored==='light'||stored==='dark'?stored:'system')+'"]');if(pick){pick.checked=true;}form.addEventListener('change',function(event){var value=event.target.value;try{if(value==='light'||value==='dark'){localStorage.setItem(key,value);}else{localStorage.removeItem(key);}}catch(e){}if(value==='light'||value==='dark'){root.dataset.theme=value;}else{delete root.dataset.theme;}});})();`;

export const inlineScripts: readonly string[] = [themeScript, themeSwitchScript];
