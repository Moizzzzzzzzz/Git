import {Input,Textarea} from '@tarojs/components';

/** Save text as it changes; a page refresh must not discard an unblurred draft. */
export function DraftTextField({value,editable,multiline=false,placeholder,onChange}:{value:string;editable:boolean;multiline?:boolean;placeholder:string;onChange:(text:string)=>void}){
 const props={placeholderClass:'field-placeholder',disabled:!editable,value,placeholder,maxlength:multiline?2000:300,onInput:(e:{detail:{value:string}})=>{onChange(e.detail.value);}};
 return multiline ? <Textarea {...props} className="textarea"/> : <Input {...props} className="input" style={{marginTop:'16px'}}/>;
}
