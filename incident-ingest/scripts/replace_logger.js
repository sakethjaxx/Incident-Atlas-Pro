const fs = require('fs');
const path = require('path');

function processDir(dir, loggerPath) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath, loggerPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.match(/console\.(log|warn|error)/)) {
        // replace console with logger
        content = content.replace(/console\.(log|warn|error)/g, 'logger.$1');
        // add import
        let rel = path.relative(path.dirname(fullPath), loggerPath).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        // Avoid duplicate imports
        if (!content.includes('import { logger }')) {
          const lines = content.split('\n');
          const importIndex = lines.findIndex(l => l.startsWith('import '));
          if (importIndex !== -1) {
            lines.splice(importIndex, 0, `import { logger } from "${rel}";`);
          } else {
            lines.unshift(`import { logger } from "${rel}";`);
          }
          content = lines.join('\n');
        }
        
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log('Updated', fullPath);
      }
    }
  }
}

processDir(path.resolve('apps/api/src'), path.resolve('apps/api/src/lib/logger.js'));
processDir(path.resolve('apps/worker/src'), path.resolve('apps/worker/src/lib/logger.js'));
