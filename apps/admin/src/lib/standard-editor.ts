/** The simple editor cannot represent complete formal rule profiles safely. */
export function requiresControlledConfiguration(rules:unknown):boolean {
 return typeof rules==='object'&&rules!==null&&'formalProfile' in rules;
}
