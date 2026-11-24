import * as Blockly from 'blockly/core';

export class SearchDropdown extends Blockly.FieldDropdown {
  static fromJson(options) {
    const field=new SearchDropdown(options.options);
    field.maxDisplayLength=24;
    field.create=options.create;
    return field;
  }

  showEditor_() {
    const dropdown=Blockly.DropDownDiv;
    dropdown.hideWithoutAnimation();
    dropdown.clearContent();
    const content=dropdown.getContentDiv();
    const picker=document.createElement('div');
    picker.className='block-field-picker';
    const search=document.createElement('input');
    search.type='search';
    search.placeholder='Search options';
    search.setAttribute('aria-label','Search options');
    const list=document.createElement('div');
    list.className='block-field-options';
    picker.append(search,list);
    content.append(picker);

    const create=this.create?.();
    let createButton;
    if(create){
      createButton=document.createElement('button');
      createButton.type='button';
      createButton.className='block-field-create';
      createButton.textContent=create.label;
      createButton.onclick=()=>{
        const query=search.value.trim();
        dropdown.hideWithoutAnimation();
        create.open(query,value=>{
          if(this.getSourceBlock()?.isDeadOrDying()!==false)return;
          this.getOptions(false);
          this.setValue(value);
        });
      };
      picker.append(createButton);
    }
    const options=this.getOptions(false).filter(([,value])=>!create||value!=='');
    const choose=value=>{
      this.setValue(value);
      dropdown.hideWithoutAnimation();
    };
    const draw=()=>{
      const term=search.value.trim().toLocaleLowerCase();
      list.replaceChildren();
      for(const [label,value] of options){
        if(typeof label!=='string'||!label.toLocaleLowerCase().includes(term))continue;
        const button=document.createElement('button');
        button.type='button';
        button.textContent=label;
        button.setAttribute('aria-pressed',String(value===this.getValue()));
        button.onclick=()=>choose(value);
        list.append(button);
      }
      if(!list.children.length&&(term||!create)){
        const empty=document.createElement('small');
        empty.textContent='No matches';
        list.append(empty);
      }
    };
    search.addEventListener('input',draw);
    picker.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        dropdown.hideWithoutAnimation();
      }else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        const choices=[search,...picker.querySelectorAll('button')];
        const step=event.key==='ArrowDown'?1:-1;
        choices[(choices.indexOf(document.activeElement)+step+choices.length)%choices.length].focus();
        event.preventDefault();
      }else if(event.key==='Enter' && event.target===search){
        (list.querySelector('button')??createButton)?.click();
        event.preventDefault();
      }
      event.stopPropagation();
    });
    draw();
    dropdown.setColour('#232435','#51536d');
    dropdown.showPositionedByField(this);
    search.focus();
  }
}

Blockly.fieldRegistry.register('field_search_dropdown',SearchDropdown);

class ColorPicker extends Blockly.FieldTextInput {
  static fromJson(options){return new ColorPicker(options.text);}
  showEditor_(){
    const dropdown=Blockly.DropDownDiv;
    dropdown.hideWithoutAnimation();
    dropdown.clearContent();
    const input=document.createElement('input');
    input.type='color';
    input.value=this.getValue();
    input.setAttribute('aria-label','Choose color');
    input.addEventListener('input',()=>this.setValue(input.value));
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape')dropdown.hideWithoutAnimation();
      event.stopPropagation();
    });
    dropdown.getContentDiv().append(input);
    dropdown.setColour('#232435','#51536d');
    dropdown.showPositionedByField(this);
    input.focus();
  }
}

Blockly.fieldRegistry.register('field_color_picker',ColorPicker);
