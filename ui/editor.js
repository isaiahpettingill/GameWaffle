import { mount } from 'svelte';
import Editor from './Editor.svelte';
import './style.css';
document.body.classList.add("studio");
mount(Editor,{target:document.getElementById('app')});
