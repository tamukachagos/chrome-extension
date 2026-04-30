function extractFunctions(dax) {
  const regex = /\b[A-Z][A-Z0-9_]*\s*\(/gi;
  const matches = String(dax || "").match(regex) || [];
  return matches.map((match) => match.replace("(", "").trim().toUpperCase());
}

function extractColumns(dax) {
  const regex = /(?:'[^']+'|[A-Za-z0-9_]+)\[[^\]]+\]/g;
  return String(dax || "").match(regex) || [];
}

function extractTables(columns) {
  return [...new Set((columns || []).map((column) => column.split("[")[0].replace(/^'|'$/g, "")))];
}

function getNestingDepth(dax) {
  let max = 0;
  let current = 0;

  for (const char of String(dax || "")) {
    if (char === "(") current++;
    if (char === ")") current--;
    if (current > max) max = current;
  }

  return max;
}

function extractFilterConditions(dax) {
  const source = String(dax || "");
  const filterMatch = source.match(/\bFILTER\s*\(/i);
  if (!filterMatch) return null;

  const filterOpenParenIndex = filterMatch.index + filterMatch[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;

  const filterArgs = splitTopLevelArgs(source.slice(filterOpenParenIndex + 1, filterCloseParenIndex));
  if (filterArgs.length < 2) return null;

  return filterArgs.slice(1).join(", ").trim();
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = "";

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }

    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function splitTopLevelArgs(text) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }

    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(text.slice(start).trim());
  return args.filter(Boolean);
}

function parseDAX(dax) {
  const functions = extractFunctions(dax);
  const columns = extractColumns(dax);
  const tables = extractTables(columns);

  return {
    source: String(dax || ""),
    functions,
    columns,
    tables,
    filterCondition: extractFilterConditions(dax),
    hasIterator: functions.some((fn) => fn.endsWith("X")),
    hasFilter: functions.includes("FILTER"),
    depth: getNestingDepth(dax)
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    extractColumns,
    extractFunctions,
    extractFilterConditions,
    extractTables,
    getNestingDepth,
    parseDAX
  };
}
