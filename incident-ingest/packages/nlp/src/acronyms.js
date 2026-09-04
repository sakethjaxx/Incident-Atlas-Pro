/**
 * @pkg/nlp — SRE/DevOps acronym expansion
 *
 * Provides a domain-specific dictionary of common acronyms used in incident
 * postmortems (infrastructure, cloud, databases, networking) and a query
 * normalization function that injects expanded forms alongside the original
 * tokens so both short-form and long-form text is matched by FTS.
 *
 * Used by the search and QA retrieval layers to fix the "acronym FTS gap":
 * plainto_tsquery ANDs every term, so short acronyms that don't appear
 * literally in the tsvector (e.g. "k8s", "s3", "oom", "ssl") produce zero
 * hits. By injecting expansions, both forms land in the query so at least
 * one matches.
 *
 * Zero runtime dependencies — pure ESM.
 */

/**
 * Map from lowercase acronym/short-form → array of expanded forms.
 *
 * Rules:
 *   - Key: the token exactly as a user might type it (lowercase).
 *   - Value: array of strings to inject into the expanded query. Inject the
 *     full technical name plus any common aliases. Keep expansions short
 *     (≤ 4 words) so the FTS query stays readable and performant.
 *   - Never remove a key once shipped — old documents may use either form.
 */
export const ACRONYM_MAP = new Map([
  // ── Cloud / storage ────────────────────────────────────────────────────────
  ["s3",       ["s3", "object storage", "aws s3"]],
  ["ec2",      ["ec2", "instance", "virtual machine", "aws ec2"]],
  ["rds",      ["rds", "relational database service", "aws rds"]],
  ["elb",      ["elb", "elastic load balancer", "load balancer"]],
  ["alb",      ["alb", "application load balancer"]],
  ["nlb",      ["nlb", "network load balancer"]],
  ["sqs",      ["sqs", "simple queue service", "message queue"]],
  ["sns",      ["sns", "simple notification service"]],
  ["ebs",      ["ebs", "elastic block store", "block storage"]],
  ["efs",      ["efs", "elastic file system"]],
  ["ecr",      ["ecr", "container registry", "elastic container registry"]],
  ["ecs",      ["ecs", "container service", "elastic container service"]],
  ["eks",      ["eks", "kubernetes", "elastic kubernetes service"]],
  ["lambda",   ["lambda", "serverless function", "aws lambda"]],
  ["cloudfront", ["cloudfront", "cdn", "content delivery network"]],
  ["route53",  ["route53", "dns", "domain name service"]],
  ["iam",      ["iam", "identity access management", "permissions", "roles"]],
  ["vpc",      ["vpc", "virtual private cloud", "network"]],
  ["kms",      ["kms", "key management service", "encryption key"]],
  ["ssm",      ["ssm", "systems manager", "parameter store"]],
  ["cloudwatch", ["cloudwatch", "monitoring", "metrics", "logs", "alerting"]],
  ["elasticache", ["elasticache", "redis", "memcached", "cache cluster"]],
  ["aurora",   ["aurora", "rds aurora", "mysql", "postgresql"]],

  // ── Kubernetes / container platform ───────────────────────────────────────
  ["k8s",      ["k8s", "kubernetes"]],
  ["kube",     ["kube", "kubernetes"]],
  ["pod",      ["pod", "container", "kubernetes pod"]],
  ["pvc",      ["pvc", "persistent volume claim", "storage volume"]],
  ["hpa",      ["hpa", "horizontal pod autoscaler", "autoscaling"]],
  ["vpa",      ["vpa", "vertical pod autoscaler"]],
  ["crd",      ["crd", "custom resource definition"]],
  ["helm",     ["helm", "kubernetes package", "chart"]],
  ["istio",    ["istio", "service mesh", "sidecar proxy"]],
  ["etcd",     ["etcd", "distributed key value store", "cluster state"]],
  ["kubelet",  ["kubelet", "node agent", "kubernetes agent"]],

  // ── Database ───────────────────────────────────────────────────────────────
  ["db",       ["db", "database"]],
  ["pg",       ["pg", "postgres", "postgresql"]],
  ["psql",     ["psql", "postgres", "postgresql"]],
  ["mysql",    ["mysql", "relational database"]],
  ["mongo",    ["mongo", "mongodb", "document database"]],
  ["redis",    ["redis", "cache", "in-memory database"]],
  ["kafka",    ["kafka", "message broker", "event streaming"]],
  ["es",       ["es", "elasticsearch"]],
  ["elastic",  ["elastic", "elasticsearch", "search engine"]],

  // ── Networking / protocols ─────────────────────────────────────────────────
  ["dns",      ["dns", "domain name system", "name resolution"]],
  ["ssl",      ["ssl", "tls", "certificate", "https", "secure connection"]],
  ["tls",      ["tls", "ssl", "certificate", "encryption"]],
  ["http",     ["http", "web request", "api call"]],
  ["https",    ["https", "ssl", "tls", "secure web request"]],
  ["tcp",      ["tcp", "connection", "network protocol"]],
  ["udp",      ["udp", "network protocol", "datagram"]],
  ["ip",       ["ip", "network address", "internet protocol"]],
  ["cdn",      ["cdn", "content delivery network", "cloudfront", "edge cache"]],
  ["nat",      ["nat", "network address translation"]],
  ["bgp",      ["bgp", "border gateway protocol", "routing"]],
  ["grpc",     ["grpc", "remote procedure call", "protocol buffers"]],

  // ── Reliability / failure modes ────────────────────────────────────────────
  ["oom",      ["oom", "out of memory", "memory limit", "memory exhausted"]],
  ["cpu",      ["cpu", "processor", "compute", "throttle"]],
  ["io",       ["io", "disk io", "input output"]],
  ["latency",  ["latency", "response time", "slowness", "delay"]],
  ["slo",      ["slo", "service level objective", "reliability target"]],
  ["sla",      ["sla", "service level agreement"]],
  ["sli",      ["sli", "service level indicator"]],
  ["mttr",     ["mttr", "mean time to recover", "recovery time"]],
  ["mttd",     ["mttd", "mean time to detect", "detection time"]],
  ["mtbf",     ["mtbf", "mean time between failures"]],
  ["p99",      ["p99", "percentile", "tail latency"]],
  ["p95",      ["p95", "percentile", "tail latency"]],
  ["p50",      ["p50", "median", "latency percentile"]],
  ["4xx",      ["4xx", "client error", "http error"]],
  ["5xx",      ["5xx", "server error", "http error", "internal server error"]],
  ["503",      ["503", "service unavailable", "overloaded"]],
  ["502",      ["502", "bad gateway", "upstream error"]],
  ["500",      ["500", "internal server error", "server crash"]],
  ["404",      ["404", "not found", "missing resource"]],

  // ── Incident management ────────────────────────────────────────────────────
  ["rca",      ["rca", "root cause analysis", "root cause"]],
  ["postmortem", ["postmortem", "incident review", "retrospective"]],
  ["runbook",  ["runbook", "playbook", "incident procedure"]],
  ["on-call",  ["on-call", "oncall", "pagerduty", "alerting"]],
  ["pagerduty", ["pagerduty", "alert", "on-call", "incident notification"]],
  ["sev1",     ["sev1", "sev-1", "severity 1", "critical incident", "p1"]],
  ["sev2",     ["sev2", "sev-2", "severity 2", "major incident", "p2"]],
  ["sev3",     ["sev3", "sev-3", "severity 3", "minor incident", "p3"]],
  ["p1",       ["p1", "priority 1", "critical", "sev1", "sev-1"]],
  ["p2",       ["p2", "priority 2", "major", "sev2", "sev-2"]],

  // ── CI/CD / deployment ─────────────────────────────────────────────────────
  ["ci",       ["ci", "continuous integration", "build pipeline"]],
  ["cd",       ["cd", "continuous deployment", "continuous delivery"]],
  ["cicd",     ["cicd", "ci/cd", "pipeline", "deployment automation"]],
  ["pr",       ["pr", "pull request", "code review", "merge request"]],
  ["mr",       ["mr", "merge request", "pull request"]],
  ["git",      ["git", "version control", "source control"]],
  ["deploy",   ["deploy", "deployment", "release", "rollout"]],
  ["rollback", ["rollback", "revert", "undo deploy", "previous version"]],
  ["canary",   ["canary", "staged rollout", "canary deploy"]],
  ["blue-green", ["blue-green", "zero downtime deploy", "switch traffic"]],

  // ── Monitoring / observability ─────────────────────────────────────────────
  ["apm",      ["apm", "application performance monitoring", "tracing"]],
  ["otel",     ["otel", "opentelemetry", "distributed tracing"]],
  ["grafana",  ["grafana", "dashboard", "metrics visualization"]],
  ["prometheus", ["prometheus", "metrics", "time series", "alerting"]],
  ["datadog",  ["datadog", "monitoring", "apm", "logs"]],
  ["newrelic",  ["newrelic", "new relic", "apm", "monitoring"]],
  ["jaeger",   ["jaeger", "distributed tracing", "trace"]],
  ["loki",     ["loki", "log aggregation", "log query"]],
  ["elk",      ["elk", "elasticsearch logstash kibana", "log stack"]],
]);

/**
 * Expand a single query token using the acronym dictionary.
 *
 * Returns the original token plus any additional expansion tokens.
 * If the token is not in the dictionary, returns [token] unchanged.
 *
 * @param {string} token - Lowercase token to expand
 * @returns {string[]} Array of tokens (original + expansions, deduplicated)
 */
export function expandToken(token) {
  const normalized = token.toLowerCase().trim();
  const expansions = ACRONYM_MAP.get(normalized);
  if (!expansions) return [normalized];

  // Flatten expansion phrases into individual tokens; always keep the original
  const result = new Set([normalized]);
  for (const phrase of expansions) {
    for (const word of phrase.toLowerCase().split(/\s+/)) {
      if (word.length >= 2) result.add(word);
    }
  }
  return [...result];
}

/**
 * Normalize a user search query for FTS by expanding known acronyms.
 *
 * Strategy:
 *   1. Tokenize the query (split on whitespace/punctuation).
 *   2. For each token, check the acronym map.
 *   3. If found, append the expansion tokens to the query string.
 *   4. Deduplicate the final token list.
 *   5. Reconstruct as a space-separated string suitable for websearch_to_tsquery.
 *
 * @param {string} query - Raw user query
 * @returns {{ expanded: string, hasAcronyms: boolean, foundAcronyms: string[] }}
 */
export function expandQueryAcronyms(query) {
  const raw = String(query ?? "").trim();
  if (!raw) return { expanded: raw, hasAcronyms: false, foundAcronyms: [] };

  // Split on whitespace and punctuation (keep alphanumeric + hyphens)
  const tokens = raw.toLowerCase().match(/[a-z0-9][a-z0-9/_.-]*/g) ?? [];
  const foundAcronyms = [];
  const expanded = new Set();

  // Preserve original query words first (case-insensitive for dedup)
  for (const token of tokens) {
    expanded.add(token.toLowerCase());
  }

  // Inject expansions
  for (const token of tokens) {
    const key = token.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const expansions = ACRONYM_MAP.get(key);
    if (expansions) {
      foundAcronyms.push(key);
      for (const phrase of expansions) {
        for (const word of phrase.split(/\s+/)) {
          if (word.length >= 2) expanded.add(word.toLowerCase());
        }
      }
    }
  }

  return {
    expanded: [...expanded].join(" "),
    hasAcronyms: foundAcronyms.length > 0,
    foundAcronyms: [...new Set(foundAcronyms)],
  };
}

/**
 * Suggest query completions/hints for known acronyms found in a partial query.
 * Used by the search UI to show expansion hints to the user.
 *
 * @param {string} query - Partial or full user query
 * @returns {Array<{ acronym: string, suggestion: string }>}
 */
export function getAcronymHints(query) {
  const raw = String(query ?? "").trim().toLowerCase();
  const tokens = raw.match(/[a-z0-9][a-z0-9/_.-]*/g) ?? [];
  const hints = [];

  for (const token of tokens) {
    const key = token.replace(/[^a-z0-9-]/g, "");
    const expansions = ACRONYM_MAP.get(key);
    if (!expansions) continue;

    // Find the most descriptive expansion phrase (most words, not the same as the key)
    const bestExpansion = expansions
      .filter((phrase) => phrase !== key)
      .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)[0];

    if (bestExpansion) {
      hints.push({ acronym: key, suggestion: bestExpansion });
    }
  }

  return hints;
}
