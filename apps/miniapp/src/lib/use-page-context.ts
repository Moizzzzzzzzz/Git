import {useState} from 'react';
import {currentContext} from './session-context';
import {requestScoped} from './api';
export function usePageContext(){return useState(currentContext)[0];}
export function usePageApi(){const c=usePageContext();return {
 get:<T>(p:string)=>requestScoped<T>(c,'GET',p),post:<T>(p:string,d?:unknown)=>requestScoped<T>(c,'POST',p,d??{}),put:<T>(p:string,d?:unknown)=>requestScoped<T>(c,'PUT',p,d??{}),
};}
