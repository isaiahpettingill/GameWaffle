import { mount } from 'svelte';
import Projects from './Projects.svelte';
import './style.css';
document.body.classList.add("studio");
mount(Projects,{target:document.getElementById('app')});
