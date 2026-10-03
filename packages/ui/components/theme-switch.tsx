import { raw } from 'hono/html';
import { SegmentedControl } from './segmented-control.tsx';

export const THEME_KEY = 'uw-theme';

const choices = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const switchScript = `(function(){var root=document.documentElement;var key='${THEME_KEY}';var stored=null;try{stored=localStorage.getItem(key);}catch(e){}var form=document.getElementById('uw-theme-switch');if(!form){return;}var pick=form.querySelector('input[value="'+(stored==='light'||stored==='dark'?stored:'system')+'"]');if(pick){pick.checked=true;}form.addEventListener('change',function(event){var value=event.target.value;try{if(value==='light'||value==='dark'){localStorage.setItem(key,value);}else{localStorage.removeItem(key);}}catch(e){}if(value==='light'||value==='dark'){root.dataset.theme=value;}else{delete root.dataset.theme;}});})();`;

export function ThemeSwitch() {
  return (
    <div id="uw-theme-switch">
      <SegmentedControl name="theme" legend="Colour theme" choices={choices} selected="system" />
      <script>{raw(switchScript)}</script>
    </div>
  );
}
