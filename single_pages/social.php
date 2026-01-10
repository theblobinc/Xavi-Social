<?php

declare(strict_types=1);

defined('C5_EXECUTE') or die('Access Denied.');

// Mirror the Concrete editing-safe pattern used by /xavi_multi_grid:
// when a logged-in user is in edit mode, don't boot the SPA JS.
$enableSPA = true;
try {
	$user = new \Concrete\Core\User\User();
	$page = \Concrete\Core\Page\Page::getCurrentPage();
	if ($user->isRegistered() && $page && $page->isEditMode()) {
		$enableSPA = false;
	}
} catch (\Throwable $e) {
	// If the CMS context isn't fully available for any reason, default to enabling the SPA.
}

// Optional CMS area (useful for layout/content around the SPA).
$area = null;
$currentPage = null;
try {
	$currentPage = \Concrete\Core\Page\Page::getCurrentPage();
	$area = new \Concrete\Core\Area\Area('Main');
	$area->setAreaGridMaximumColumns(12);
	$area->enableGridContainer();
} catch (\Throwable $e) {
	$area = null;
}

// Multi-grid module system is vendored into this package so /social doesn't depend on
// /application/single_pages/xavi_multi_grid (example code).
$packageDir = dirname(__DIR__);
$multiGridDir = $packageDir . '/multigrid';
$dirRel = defined('DIR_REL') ? rtrim((string) constant('DIR_REL'), '/') : '';
if ($dirRel !== '' && substr($dirRel, 0, 1) !== '/') {
	$dirRel = '/' . $dirRel;
}
$baseUrl = $dirRel;
$multiGridBaseUrl = $baseUrl . '/packages/xavi_social/multigrid';

?>

<section class="xavi-social-cms-area">
	<?php if ($area && $currentPage) { $area->display($currentPage); } ?>
</section>

<?php if ($enableSPA) : ?>
	<div class="xavi-grid-shell">
		<div id="xavi-grid-container" class="xavi-grid-container">
			<music-player style="display:none;"></music-player>
			<div id="xavi-settings-overlay" class="settings-overlay" data-floating-layer="true" data-mode="settings">
				<div class="settings-overlay-content"></div>
				<div class="settings-resize-handle" aria-hidden="true"></div>
			</div>
			<button id="xavi-settings-toggle-tab" class="settings-toggle-tab" title="Settings">
				<span class="arrow">▶</span>
			</button>
			<video-player></video-player>
		</div>
	</div>

	<style>
		html, body {
			height: 100%;
			margin: 0;
			padding: 0;
			overflow-x: hidden;
		}

		/* Hide CMS blocks while the app is active (keeps layout stable). */
		.xavi-social-cms-area { display: none; }

		.xavi-grid-shell {
			position: fixed;
			top: var(--xavi-nav-h, 0px);
			left: 0;
			right: 0;
			bottom: 0;
			width: 100%;
			max-width: none;
			margin: 0;
			padding: 0;
			z-index: 0;
		}

		#xavi-grid-container {
			position: relative;
			inset: 0;
			width: 100%;
			height: 100%;
			min-height: 0;
			max-height: none;
			max-width: 100%;
			background-color: black;
			padding: 0;
			margin: 0;
			overflow: hidden;
		}

		xavi-multi-grid {
			display: block;
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			width: 100%;
			height: 100%;
		}

		music-player,
		video-player {
			display: block;
		}

		music-player {
			display: none !important;
			position: relative;
			z-index: 1150;
		}
	</style>

	<script>
		// Suppress noisy YouTube-related warnings that can clutter the console.
		(function () {
			if (typeof console === 'undefined' || typeof console.warn !== 'function') {
				return;
			}
			const originalWarn = console.warn.bind(console);
			const patterns = [
				/youtube\.com/i,
				/ytimg\.com/i,
				/\bYT\b/i,
				/youtube/i,
			];
			console.warn = function (...args) {
				try {
					const msg = args
						.map(a => (typeof a === 'string' ? a : ''))
						.join(' ');
					if (patterns.some((re) => re.test(msg))) {
						return;
					}
				} catch (e) {
					// Fall through.
				}
				return originalWarn(...args);
			};
		})();
	</script>

	<!-- Load External Libraries (YouTube / Fuse.js) -->
	<script src="https://www.youtube.com/iframe_api"></script>
	<script src="https://cdn.jsdelivr.net/npm/fuse.js@6.6.2"></script>

	<script>
		window.XAVI_MODULE_CONFIGS = <?php
			$modulesDir = $multiGridDir . '/js/modules';
			$moduleConfigs = [];
			$moduleAssetVersionMax = 0;
			if (is_dir($modulesDir)) {
				$moduleDirs = array_filter(scandir($modulesDir), function ($item) use ($modulesDir) {
					return $item !== '.' && $item !== '..' && is_dir($modulesDir . '/' . $item);
				});
				foreach ($moduleDirs as $moduleDir) {
					$configFile = $modulesDir . '/' . $moduleDir . '/module.json';
					if (file_exists($configFile)) {
						$config = json_decode((string) file_get_contents($configFile), true);
						if ($config) {
							$scriptOk = true;
							if (isset($config['scripts']) && is_array($config['scripts'])) {
								foreach ($config['scripts'] as $scriptRel) {
									$scriptAbs = $modulesDir . '/' . $moduleDir . '/' . $scriptRel;
									if (!is_file($scriptAbs) || @filesize($scriptAbs) < 16) {
										$scriptOk = false;
										break;
									}
									$mtime = @filemtime($scriptAbs);
									if ($mtime && $mtime > $moduleAssetVersionMax) {
										$moduleAssetVersionMax = (int) $mtime;
									}
									$fh = @fopen($scriptAbs, 'rb');
									$chunk = $fh ? @fread($fh, 64) : '';
									if ($fh) {
										@fclose($fh);
									}
									if ($chunk === '' || trim(str_replace("\0", '', $chunk)) === '') {
										$scriptOk = false;
										break;
									}
								}
							}
							if (!$scriptOk) {
								continue;
							}
							$config['path'] = $multiGridBaseUrl . '/js/modules/' . $moduleDir;
							$moduleConfigs[$moduleDir] = $config;
						}
					}
				}
			}
			echo json_encode($moduleConfigs, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
		?>;
	</script>

	<?php
		$webRoot = dirname(__DIR__, 3);
		$xaviAsset = function (string $webPath) use ($baseUrl, $webRoot) {
			$abs = $webRoot . $webPath;
			$v = @filemtime($abs);
			if (!$v) {
				$v = time();
			}
			return $baseUrl . $webPath . '?v=' . $v;
		};
		$assetVersion = max(
			(int) (@filemtime($multiGridDir . '/js/z-index-manager.js') ?: 0),
			(int) (@filemtime($multiGridDir . '/js/grid-objects.js') ?: 0),
			(int) (@filemtime($multiGridDir . '/js/workspace.js') ?: 0),
			(int) (@filemtime($multiGridDir . '/js/main.js') ?: 0),
			(int) ($moduleAssetVersionMax ?: 0),
			(int) (@filemtime(__FILE__) ?: 0)
		);
	?>

	<script>
		window.XAVI_ASSET_VERSION = <?php echo (int) $assetVersion; ?>;
		window.XAVI_MULTIGRID_BASE = window.XAVI_MULTIGRID_BASE || <?php echo json_encode($multiGridBaseUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
		window.XAVI_API_BASE = window.XAVI_API_BASE || <?php echo json_encode($baseUrl . '/social/api', JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
	</script>

	<!-- Load z-index manager first -->
	<script src="<?php echo $xaviAsset('/packages/xavi_social/multigrid/js/z-index-manager.js'); ?>"></script>
	<!-- Load grid objects manager for draggable/resizable panels -->
	<script src="<?php echo $xaviAsset('/packages/xavi_social/multigrid/js/grid-objects.js'); ?>"></script>
	<!-- Load workspace.js and main.js - workspace handles module loading -->
	<script src="<?php echo $xaviAsset('/packages/xavi_social/multigrid/js/workspace.js'); ?>"></script>
	<script defer src="<?php echo $xaviAsset('/packages/xavi_social/multigrid/js/main.js'); ?>"></script>

	<script>
		(function () {
			function measureNav() {
				const header = document.querySelector('header.primary-header') || document.querySelector('header');
				const navH = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
				document.documentElement.style.setProperty('--xavi-nav-h', navH + 'px');
				if (!document.documentElement.style.getPropertyValue('--xavi-taskbar-h')) {
					document.documentElement.style.setProperty('--xavi-taskbar-h', '108px');
				}
			}
			document.addEventListener('DOMContentLoaded', () => {
				measureNav();
				window.addEventListener('resize', measureNav);
				window.addEventListener('orientationchange', measureNav);
				const header = document.querySelector('header.primary-header') || document.querySelector('header');
				if (header && typeof ResizeObserver !== 'undefined') {
					try {
						const ro = new ResizeObserver(measureNav);
						ro.observe(header);
					} catch (e) {
						// ignore
					}
				}
			});
		})();
	</script>

	<style>
		.hide-button {
			border: 1px solid white;
			padding: 5px;
			background-color: transparent;
			color: white;
			cursor: pointer;
		}
		.hide-button:hover {
			background-color: rgba(255,255,255,0.1);
			color: white;
		}
	</style>
<?php endif; ?>
