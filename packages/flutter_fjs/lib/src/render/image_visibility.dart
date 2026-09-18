// Image visibility without a third-party detector. The existing renderer
// already uses RenderBox coordinates and RenderAbstractViewport for culling,
// so the same primitives keep lazy-load timing tied to fjs scroll events.
import 'package:flutter/scheduler.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

class FjsImageVisibilityHandle {
  FjsImageVisibilityHandle(this.context, this.onVisible, this.onFallback);

  final BuildContext context;
  final VoidCallback onVisible;
  final VoidCallback? onFallback;
}

final Set<FjsImageVisibilityHandle> _handles = <FjsImageVisibilityHandle>{};

/// Kept in step with `IMAGE_LAZY_PRELOAD_PX` in
/// `fjs-runtime/src/image/lazy.ts`, which the web adapter passes to
/// IntersectionObserver as its rootMargin.
const double _preloadSlack = 240;
bool _refreshQueued = false;

FjsImageVisibilityHandle registerFjsImageVisibility(
  BuildContext context,
  VoidCallback onVisible, {
  VoidCallback? onFallback,
}) {
  final handle = FjsImageVisibilityHandle(context, onVisible, onFallback);
  _handles.add(handle);
  scheduleFjsImageVisibilityRefresh();
  return handle;
}

void unregisterFjsImageVisibility(FjsImageVisibilityHandle handle) {
  _handles.remove(handle);
}

void scheduleFjsImageVisibilityRefresh() {
  if (_handles.isEmpty || _refreshQueued) return;
  _refreshQueued = true;
  SchedulerBinding.instance.addPostFrameCallback((_) {
    _refreshQueued = false;
    refreshFjsImageVisibility();
  });
}

void refreshFjsImageVisibility() {
  if (_handles.isEmpty) return;
  for (final handle in List<FjsImageVisibilityHandle>.of(_handles)) {
    if (!_handles.contains(handle)) continue;
    if (_isNearViewport(handle.context, handle.onFallback)) {
      _handles.remove(handle);
      handle.onVisible();
    }
  }
}

bool _isNearViewport(BuildContext context, VoidCallback? onFallback) {
  final object = context.findRenderObject();
  if (object is! RenderBox || !object.hasSize || !object.attached) {
    return false;
  }
  final imageRect = object.localToGlobal(Offset.zero) & object.size;
  RenderObject? probe = object;
  var foundViewport = false;
  while (probe != null) {
    final viewport = RenderAbstractViewport.maybeOf(probe);
    if (viewport == null) break;
    foundViewport = true;
    final viewportBox = viewport is RenderBox ? viewport as RenderBox : null;
    if (viewportBox != null && viewportBox.hasSize) {
      final viewportRect =
          viewportBox.localToGlobal(Offset.zero) & viewportBox.size;
      if (!imageRect.inflate(_preloadSlack).overlaps(viewportRect)) {
        return false;
      }
    }
    probe = viewport.parent;
  }
  // Outside a scrollable, the page itself is the visibility boundary. This is
  // a supported fallback, but it must be visible to the page author: a custom
  // host that never exposes a viewport cannot provide scroll-triggered lazy
  // loading semantics.
  if (!foundViewport) onFallback?.call();
  return foundViewport || object.attached;
}
