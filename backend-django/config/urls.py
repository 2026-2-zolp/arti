# API URL을 Django 처리 함수에 연결합니다.
from django.urls import path, re_path
from arti import views
from arti import member, editing, records, docent

handler404 = 'arti.http.not_found'
urlpatterns = [
    path('api/health', views.health), path('api/ready', views.ready),
    path('api/exhibitions', views.exhibitions), path('api/exhibitions/<str:ex_id>', views.exhibitions),
    path('api/exhibitions/<str:ex_id>/tag-coverage', views.coverage),
    path('api/taste-pool', views.taste_pool),
    path('api/taste-profiles/resolve', views.resolve_taste),
    path('api/exhibitions/<str:ex_id>/taste-pool', views.taste_pool),
    path('api/artworks', views.artworks), path('api/artworks/<str:artwork_id>', views.artworks),
    path('api/recommendations', views.recommendations),
    path('api/admin/login', views.admin_login), path('api/admin/logout', views.admin_logout),
    path('api/admin/exhibitions', editing.exhibitions),
    path('api/admin/exhibitions/<str:ex_id>', editing.exhibitions),
    path('api/admin/artworks', editing.artworks),
    path('api/admin/artworks/<str:artwork_id>', editing.artworks),
    path('api/admin/artworks/<str:artwork_id>/image', editing.image),
    path('api/admin/exhibitions/<str:ex_id>/floor-plan', editing.image),
    path('api/admin/artworks/<str:artwork_id>/analyze', editing.analyze),
    path('api/admin/exhibitions/<str:ex_id>/confirm-ai', editing.confirm_ai),
    path('api/admin/members', records.members), path('api/admin/reactions', records.reactions),
    path('api/admin/visits/<str:visit_id>', records.admin_visit),
    path('api/auth/signup', member.signup),path('api/auth/login', member.login),
    path('api/auth/me', member.me),path('api/auth/logout', member.logout),
    path('api/auth/password-reset/request', member.reset_disabled),path('api/auth/password-reset/confirm', member.reset_disabled),
    path('api/users/<str:user_id>/tastes', member.tastes),path('api/users/<str:user_id>/visits', records.visits),
    path('api/visits', records.save_visit),path('api/visits/interpret', records.interpret),path('api/visits/<str:visit_id>', records.visits),
    path('api/artworks/<str:artwork_id>/ask', docent.ask),path('api/artworks/<str:artwork_id>/explanation', docent.explanation),
    path('api/uploads/<str:filename>', views.media), path('api/admin/uploads/<str:filename>', views.media),
    re_path(r'^api/(?:auth|users|visits)(?:/.*)?$', views.unavailable),
    re_path(r'^api/artworks/(?P<artwork_id>[^/]+)/(?:ask|explanation)$', views.unavailable_artwork),
    re_path(r'^api/admin/.*$', views.unavailable),
]
