import { describe, it, expect, beforeEach } from 'vitest';
import { FindingCollector, createFindingCollector, type FindingReport } from '../../../../src/core/findings/finding-collector';
import { createFinding } from '../../../../src/core/findings/finding';

describe('FindingCollector', () => {
  let collector: FindingCollector;

  beforeEach(() => {
    collector = new FindingCollector();
  });

  describe('constructor', () => {
    it('should create collector with default options', () => {
      expect(collector).toBeDefined();
      expect(collector.count()).toBe(0);
    });

    it('should create collector with custom options', () => {
      const customCollector = new FindingCollector({
        autoSortBySeverity: false,
        autoGroupBySeverity: false,
        maxFindingsPerReport: 100,
      });
      expect(customCollector).toBeDefined();
    });
  });

  describe('addFinding', () => {
    it('should add a single finding', () => {
      const finding = createFinding('Test', 'Description', 'security', 'critical', {
        module: 'test-module',
      });
      collector.addFinding(finding);
      expect(collector.count()).toBe(1);
    });

    it('should add multiple findings', () => {
      const finding1 = createFinding('Test1', 'Desc1', 'security', 'critical', {
        module: 'test-module',
      });
      const finding2 = createFinding('Test2', 'Desc2', 'performance', 'high', {
        module: 'test-module',
      });
      collector.addFinding(finding1);
      collector.addFinding(finding2);
      expect(collector.count()).toBe(2);
    });

    it('should update existing finding if added again', () => {
      const finding = createFinding('Test', 'Description', 'security', 'critical', {
        module: 'test-module',
      });
      collector.addFinding(finding);
      const updated = { ...finding, description: 'Updated' };
      collector.addFinding(updated);
      expect(collector.count()).toBe(1);
    });
  });

  describe('addFindings', () => {
    it('should add multiple findings at once', () => {
      const findings = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'test-module' }),
      ];
      collector.addFindings(findings);
      expect(collector.count()).toBe(3);
    });
  });

  describe('removeFinding', () => {
    it('should remove a finding by ID', () => {
      const finding = createFinding('Test', 'Description', 'security', 'critical', {
        module: 'test-module',
      });
      collector.addFinding(finding);
      expect(collector.count()).toBe(1);
      collector.removeFinding(finding.id);
      expect(collector.count()).toBe(0);
    });

    it('should return false if finding not found', () => {
      const result = collector.removeFinding('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('updateFindingStatus', () => {
    it('should update finding status', () => {
      const finding = createFinding('Test', 'Description', 'security', 'critical', {
        module: 'test-module',
      });
      collector.addFinding(finding);
      const updated = collector.updateFindingStatus(finding.id, 'resolved');
      expect(updated).toBe(true);
      expect(collector.getFinding(finding.id)?.status).toBe('resolved');
    });

    it('should return false if finding not found', () => {
      const result = collector.updateFindingStatus('non-existent', 'resolved');
      expect(result).toBe(false);
    });
  });

  describe('getFinding', () => {
    it('should retrieve a finding by ID', () => {
      const finding = createFinding('Test', 'Description', 'security', 'critical', {
        module: 'test-module',
      });
      collector.addFinding(finding);
      const retrieved = collector.getFinding(finding.id);
      expect(retrieved?.id).toBe(finding.id);
    });

    it('should return undefined if finding not found', () => {
      expect(collector.getFinding('non-existent')).toBeUndefined();
    });
  });

  describe('getAllFindings', () => {
    it('should return all findings', () => {
      const findings = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ];
      collector.addFindings(findings);
      const all = collector.getAllFindings();
      expect(all).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all findings', () => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ]);
      expect(collector.count()).toBe(2);
      collector.clear();
      expect(collector.count()).toBe(0);
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'module-a' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'module-b' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'module-a' }),
        createFinding('Test4', 'Desc4', 'dependency', 'low', { module: 'module-c' }),
      ]);
    });

    it('should filter by severity', () => {
      const critical = collector.filter({ severities: ['critical'] });
      expect(critical).toHaveLength(1);
      expect(critical[0].severity).toBe('critical');
    });

    it('should filter by category', () => {
      const security = collector.filter({ categories: ['security'] });
      expect(security).toHaveLength(1);
    });

    it('should filter by module', () => {
      const moduleA = collector.filter({ modules: ['module-a'] });
      expect(moduleA).toHaveLength(2);
    });

    it('should filter by status', () => {
      collector.updateFindingStatus(
        collector.getAllFindings()[0].id,
        'resolved'
      );
      const open = collector.filter({ statuses: ['open'] });
      expect(open.length).toBeLessThan(collector.count());
    });

    it('should filter by minimum severity level', () => {
      const highAndUp = collector.filter({ minSeverityLevel: 4 }); // high=4, critical=5
      expect(highAndUp.length).toBeGreaterThanOrEqual(2);
    });

    it('should combine multiple filters', () => {
      const results = collector.filter({
        severities: ['critical', 'high'],
        modules: ['module-a', 'module-b'],
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('groupBySeverity', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'test-module' }),
      ]);
    });

    it('should group findings by severity', () => {
      const grouped = collector.groupBySeverity();
      expect(grouped.size).toBe(5); // all severity levels
      expect(grouped.get('critical')).toHaveLength(1);
      expect(grouped.get('high')).toHaveLength(1);
      expect(grouped.get('medium')).toHaveLength(1);
    });
  });

  describe('groupByCategory', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'security', 'medium', { module: 'test-module' }),
      ]);
    });

    it('should group findings by category', () => {
      const grouped = collector.groupByCategory();
      expect(grouped.size).toBe(2);
      expect(grouped.get('security')).toHaveLength(2);
      expect(grouped.get('performance')).toHaveLength(1);
    });
  });

  describe('groupByModule', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'module-a' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'module-b' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'module-a' }),
      ]);
    });

    it('should group findings by module', () => {
      const grouped = collector.groupByModule();
      expect(grouped.size).toBe(2);
      expect(grouped.get('module-a')).toHaveLength(2);
      expect(grouped.get('module-b')).toHaveLength(1);
    });
  });

  describe('groupByStatus', () => {
    beforeEach(() => {
      const findings = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ];
      collector.addFindings(findings);
      collector.updateFindingStatus(findings[0].id, 'resolved');
    });

    it('should group findings by status', () => {
      const grouped = collector.groupByStatus();
      expect(grouped.size).toBe(4);
      expect(grouped.get('open')).toHaveLength(1);
      expect(grouped.get('resolved')).toHaveLength(1);
    });
  });

  describe('calculateStats', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'test-module' }),
      ]);
    });

    it('should calculate statistics', () => {
      const stats = collector.calculateStats();
      expect(stats.total).toBe(3);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.bySeverity.high).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.byCategory.security).toBe(1);
      expect(stats.byCategory.performance).toBe(1);
      expect(stats.byCategory.reliability).toBe(1);
    });
  });

  describe('generateReport', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ]);
    });

    it('should generate a report', () => {
      const report = collector.generateReport() as FindingReport;
      expect(report.totalFindings).toBe(2);
      expect(report.byCriticalSeverity).toHaveLength(1);
      expect(report.byHighSeverity).toHaveLength(1);
      expect(report.stats.total).toBe(2);
      expect(report.summary).toBeDefined();
    });

    it('should include summary in report', () => {
      const report = collector.generateReport() as FindingReport;
      expect(report.summary).toContain('Total Findings: 2');
      expect(report.summary).toContain('Critical: 1');
    });
  });

  describe('getFindings', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'reliability', 'critical', { module: 'test-module' }),
      ]);
    });

    it('should get findings by severity', () => {
      const critical = collector.getFindings('critical');
      expect(critical).toHaveLength(2);
    });
  });

  describe('getCriticalFindings', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
        createFinding('Test3', 'Desc3', 'reliability', 'medium', { module: 'test-module' }),
      ]);
    });

    it('should get critical and high findings', () => {
      const critical = collector.getCriticalFindings();
      expect(critical.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getOpenFindings', () => {
    beforeEach(() => {
      const findings = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ];
      collector.addFindings(findings);
      collector.updateFindingStatus(findings[0].id, 'resolved');
    });

    it('should get only open findings', () => {
      const open = collector.getOpenFindings();
      expect(open).toHaveLength(1);
      expect(open[0].status).toBe('open');
    });
  });

  describe('getResolvedFindings', () => {
    beforeEach(() => {
      const findings = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ];
      collector.addFindings(findings);
      collector.updateFindingStatus(findings[0].id, 'resolved');
    });

    it('should get only resolved findings', () => {
      const resolved = collector.getResolvedFindings();
      expect(resolved).toHaveLength(1);
    });
  });

  describe('hasCriticalFindings', () => {
    it('should return true if critical findings exist', () => {
      collector.addFinding(
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' })
      );
      expect(collector.hasCriticalFindings()).toBe(true);
    });

    it('should return false if no critical findings', () => {
      collector.addFinding(
        createFinding('Test1', 'Desc1', 'security', 'medium', { module: 'test-module' })
      );
      expect(collector.hasCriticalFindings()).toBe(false);
    });
  });

  describe('getGroupedFindings', () => {
    beforeEach(() => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ]);
    });

    it('should return findings grouped by severity', () => {
      const grouped = collector.getGroupedFindings();
      expect(grouped).toHaveLength(5);
      expect(grouped[0].severity).toBe('critical');
      expect(grouped[0].count).toBe(1);
    });
  });

  describe('merge', () => {
    it('should merge another collector', () => {
      const other = new FindingCollector();
      other.addFinding(
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' })
      );
      other.addFinding(
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' })
      );

      expect(collector.count()).toBe(0);
      collector.merge(other);
      expect(collector.count()).toBe(2);
    });
  });

  describe('export and import', () => {
    it('should export findings data', () => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ]);

      const exported = collector.export();
      expect(exported.findings).toHaveLength(2);
      expect(exported.stats.total).toBe(2);
      expect(exported.exportedAt).toBeDefined();
    });

    it('should import findings data', () => {
      const original = [
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ];
      const data = { findings: original };

      collector.import(data);
      expect(collector.count()).toBe(2);
    });
  });

  describe('clone', () => {
    it('should create a copy of the collector', () => {
      collector.addFindings([
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' }),
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' }),
      ]);

      const cloned = collector.clone();
      expect(cloned.count()).toBe(collector.count());
      expect(cloned.getAllFindings()).toHaveLength(2);
    });

    it('should be independent from original', () => {
      collector.addFinding(
        createFinding('Test1', 'Desc1', 'security', 'critical', { module: 'test-module' })
      );

      const cloned = collector.clone();
      cloned.addFinding(
        createFinding('Test2', 'Desc2', 'performance', 'high', { module: 'test-module' })
      );

      expect(collector.count()).toBe(1);
      expect(cloned.count()).toBe(2);
    });
  });
});

describe('createFindingCollector', () => {
  it('should create a collector', () => {
    const collector = createFindingCollector();
    expect(collector).toBeInstanceOf(FindingCollector);
  });

  it('should accept options', () => {
    const collector = createFindingCollector({ maxFindingsPerReport: 500 });
    expect(collector).toBeInstanceOf(FindingCollector);
  });
});
