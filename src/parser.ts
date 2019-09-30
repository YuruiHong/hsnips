import { HSnippet, HSnippetHeader } from './hsnippet';

const CODE_DELIMITER = '``';
const HEADER_REGEXP = /^snippet ?(?:([\w\d_]+)|`([^`]+)`)?(?: "([^"]+)")?(?: ([A]*))?/;

function parseSnippetHeader(header: string): HSnippetHeader {
  let match = HEADER_REGEXP.exec(header);
  if (!match) throw new Error('Invalid snippet header');

  let trigger: string | RegExp = match[1];
  if (match[2]) {
    if (!match[2].endsWith('$')) match[2] += '$';
    trigger = new RegExp(match[2]);
  }

  return {
    trigger,
    description: match[3] || '',
    flags: match[4] || ''
  };
}

function escapeString(string: string) {
  return string.replace('"', '\\"')
    .replace('\\', '\\\\');
}

function parseSnippet(header: string, lines: string[]): [string, HSnippetHeader] {
  let headerInfo = parseSnippetHeader(header);

  let script = [`(t, m) => {`];
  script.push(`let rv = "";`);
  script.push(`let result = [];`);
  script.push(`let blockResults = [];`);

  let isCode = false;

  while (lines.length > 0) {
    let line = lines.shift() as string;

    if (isCode) {
      if (!line.includes(CODE_DELIMITER)) {
        script.push(line.trim());
      } else {
        let [code, ...rest] = line.split(CODE_DELIMITER);
        script.push(code.trim());
        lines.unshift(rest.join(CODE_DELIMITER));
        script.push(`result.push({block: blockResults.length});`);
        script.push(`blockResults.push(rv);`);
        isCode = false;
      }
    } else {
      if (line.startsWith('endsnippet')) {
        break;
      } else if (!line.includes(CODE_DELIMITER)) {
        script.push(`result.push("${escapeString(line)}");`);
        script.push(`result.push("\\n");`);
      } else if (isCode == false) {
        let [text, ...rest] = line.split(CODE_DELIMITER);
        script.push(`result.push("${escapeString(text)}");`);
        script.push(`rv = "";`);
        lines.unshift(rest.join(CODE_DELIMITER));
        isCode = true;
      }
    }
  }

  // Remove extra newline at the end.
  script.pop();
  script.push(`return [result, blockResults];`);
  script.push(`}`);

  return [script.join('\n'), headerInfo];
}

// Transforms an hsnips file into a single function where the global context lives, every snippet is
// transformed into a local function inside this and the list of all snippet functions is returned
// so we can build the approppriate HSnippet objects.
export function parse(content: string): HSnippet[] {
  let lines = content.split(/\r?\n/);

  let snippetData = [];
  let script = [];
  let isCode = false;

  while (lines.length > 0) {
    let line = lines.shift() as string;

    if (isCode) {
      if (line.startsWith('endglobal')) {
        isCode = false;
      } else {
        script.push(line);
      }
    } else if (line.startsWith('global')) {
      isCode = true;
    } else if (line.match(HEADER_REGEXP)) {
      snippetData.push(parseSnippet(line, lines));
    }
  }

  script.push(`return [`);
  for (let snippet of snippetData) {
    script.push(snippet[0]);
    script.push(',');
  }
  script.push(`]`);

  let generators = new Function(script.join('\n'))();
  return snippetData.map((s, i) => new HSnippet(s[1], generators[i]));
}