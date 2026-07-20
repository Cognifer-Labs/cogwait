package io.cogwait.jetbrains;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nls;

// Registers the Cogwait status-bar widget with the IDE (official extension point).
public class CogwaitWidgetFactory implements StatusBarWidgetFactory {
    @Override
    public @NotNull String getId() {
        return "CogwaitWidget";
    }

    @Override
    public @Nls @NotNull String getDisplayName() {
        return "Cogwait";
    }

    @Override
    public boolean isAvailable(@NotNull Project project) {
        return true;
    }

    @Override
    public @NotNull StatusBarWidget createWidget(@NotNull Project project) {
        return new CogwaitWidget();
    }

    @Override
    public void disposeWidget(@NotNull StatusBarWidget widget) {
        widget.dispose();
    }

    @Override
    public boolean canBeEnabledOn(@NotNull StatusBar statusBar) {
        return true;
    }
}
