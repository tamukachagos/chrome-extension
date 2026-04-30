(function () {
  const FINAL_RULE_PATH = "rules/processed/final_rules.json";
  const COMPILED_RULE_PATH = "rules/processed/compiled_rules.json";
  const RULE_PACKS = [
    {
      key: "performance",
      path: "rules/performance_rules.json"
    },
    {
      key: "correctness",
      path: "rules/correctness_rules.json"
    }
  ];

  function getPriority(category) {
    if (category === "correctness") return 1;
    if (category === "performance") return 2;
    return 3;
  }

  async function loadJson(path) {
    const url = chrome.runtime.getURL(path);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
    }
    return response.json();
  }

  async function tryLoadJson(path) {
    try {
      return await loadJson(path);
    } catch (_) {
      return null;
    }
  }

  function sortRules(rules) {
    return rules.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if ((b.confidence || 0) !== (a.confidence || 0)) return (b.confidence || 0) - (a.confidence || 0);
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function compileRules(performanceRules, correctnessRules) {
    const rules = [
      ...performanceRules,
      ...correctnessRules
    ].map((rule, i) => ({
      id: rule.id || `RULE_${i + 1}`,
      priority: getPriority(rule.category),
      ...rule
    }));

    return sortRules(rules);
  }

  function compileProcessedRules(processedRules) {
    return sortRules(processedRules.map((rule, i) => ({
      id: rule.id || `RULE_${i + 1}`,
      priority: rule.priority || getPriority(rule.category),
      ...rule
    })));
  }

  async function loadRulePacks() {
    const processedRules = await tryLoadJson(FINAL_RULE_PATH) || await tryLoadJson(COMPILED_RULE_PATH);
    let rules;

    if (Array.isArray(processedRules) && processedRules.length > 0) {
      rules = compileProcessedRules(processedRules);
    } else {
      const [performanceRules, correctnessRules] = await Promise.all(
        RULE_PACKS.map((pack) => loadJson(pack.path))
      );
      rules = compileRules(performanceRules, correctnessRules);
    }

    const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
    const byCategory = rules.reduce((groups, rule) => {
      const category = rule.category || "uncategorized";
      groups[category] = groups[category] || [];
      groups[category].push(rule);
      return groups;
    }, {});

    window.PowerBIRulePacks = {
      rules,
      byId,
      byCategory,
      compileProcessedRules,
      compileRules,
      getPriority,
      loadedAt: new Date().toISOString()
    };

    if (window.PowerBISkillEngine?.setExternalRules) {
      window.PowerBISkillEngine.setExternalRules(rules);
    }

    if (window.PowerBIDaxEngine?.setRules) {
      window.PowerBIDaxEngine.setRules(rules);
    }

    return window.PowerBIRulePacks;
  }

  window.PowerBIRuleLoader = {
    compileProcessedRules,
    compileRules,
    getPriority,
    loadRulePacks
  };
})();
