from common.admin import BaseModelAdmin, BaseStackedInline
from django.contrib import admin
from django.contrib.auth.admin import (
    GroupAdmin as BaseGroupAdmin,
    UserAdmin as BaseUserAdmin,
)
from django.contrib.auth.models import Group
from oauth2_provider.admin import (
    AccessTokenAdmin as BaseAccessTokenAdmin,
    ApplicationAdmin as BaseApplicationAdmin,
    GrantAdmin as BaseGrantAdmin,
    IDTokenAdmin as BaseIDTokenAdmin,
    RefreshTokenAdmin as BaseRefreshTokenAdmin,
)
from oauth2_provider.models import (
    get_access_token_model,
    get_application_model,
    get_grant_model,
    get_id_token_model,
    get_refresh_token_model,
)
from organizations.models import Team
from rest_framework_api_key.admin import APIKeyAdmin
from rest_framework_api_key.models import APIKey
from simple_history.admin import SimpleHistoryAdmin
from social_django.admin import AssociationOption, NonceOption, UserSocialAuthOption
from social_django.models import Association, Nonce, UserSocialAuth
from unfold.contrib.filters.admin import (
    RangeDateFilter,
)
from unfold.decorators import display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from authentication.models import User


class TeamsInline(BaseStackedInline):
    model = Team.members.through
    tab = True
    verbose_name = "Team"
    verbose_name_plural = "Teams"


@admin.register(User)
class UserAdmin(SimpleHistoryAdmin, BaseUserAdmin, BaseModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm

    # Use email, not username on admin user form https://forum.djangoproject.com/t/custom-add-user-form-in-django-admin/16443/8
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "first_name",
                    "last_name",
                    "password1",
                    "password2",
                ),
            },
        ),
    )

    list_filter = (
        "is_active",
        "is_staff",
        "is_superuser",
        "groups",
    )

    list_display = (
        "display_user",
        "full_name",
        "is_active",
        "is_staff",
        "is_superuser",
    )

    search_fields = (
        "display_name",
        "email",
        "full_name",
    )

    @display(description="User", header=True)
    def display_user(self, obj):
        return [
            obj.display_name,
            obj.email,
            obj.initials,
        ]


admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, BaseModelAdmin):
    pass


admin.site.unregister(Association)


@admin.register(Association)
class AssociationAdmin(AssociationOption, BaseModelAdmin):
    pass


admin.site.unregister(Nonce)


@admin.register(Nonce)
class NonceAdmin(NonceOption, BaseModelAdmin):
    pass


admin.site.unregister(UserSocialAuth)


@admin.register(UserSocialAuth)
class UserSocialAuthAdmin(UserSocialAuthOption, BaseModelAdmin):
    pass


admin.site.unregister(get_access_token_model())


@admin.register(get_access_token_model())
class AccessTokenAdmin(BaseAccessTokenAdmin, BaseModelAdmin):
    pass


admin.site.unregister(get_application_model())


@admin.register(get_application_model())
class ApplicationAdmin(BaseApplicationAdmin, BaseModelAdmin):
    pass


admin.site.unregister(get_grant_model())


@admin.register(get_grant_model())
class GrantAdmin(BaseGrantAdmin, BaseModelAdmin):
    pass


admin.site.unregister(get_refresh_token_model())


@admin.register(get_refresh_token_model())
class RefreshTokenAdmin(BaseRefreshTokenAdmin, BaseModelAdmin):
    pass


admin.site.unregister(get_id_token_model())


@admin.register(get_id_token_model())
class IDTokenAdmin(BaseIDTokenAdmin, BaseModelAdmin):
    pass


admin.site.unregister(APIKey)


@admin.register(APIKey)
class APIKeyAdmin(APIKeyAdmin, BaseModelAdmin):
    list_display = (
        "name",
        "prefix",
        "revoked",
        "expiry_date",
        "created",
    )
    list_filter = (
        "revoked",
        ("expiry_date", RangeDateFilter),
        ("created", RangeDateFilter),
    )
    search_fields = ("name",)
    ordering = ("-created",)
