from django.urls import path, re_path
from arti import views

handler404 = 'arti.http.not_found'
urlpatterns = [
    path('api/health', views.health), path('api/ready', views.ready),
    path('api/exhibitions', views.exhibitions), path('api/exhibitions/<str:ex_id>', views.exhibitions),
    path('api/exhibitions/<str:ex_id>/tag-coverage', views.coverage),
    path('api/exhibitions/<str:ex_id>/taste-pool', views.taste_pool),
    path('api/artworks', views.artworks), path('api/artworks/<str:artwork_id>', views.artworks),
    path('api/recommendations', views.recommendations),
    path('api/admin/login', views.admin_login), path('api/admin/logout', views.admin_logout),
    path('api/admin/exhibitions', views.admin_exhibitions),
    path('api/admin/exhibitions/<str:ex_id>', views.admin_exhibitions),
    path('api/admin/artworks', views.admin_artworks),
    path('api/admin/artworks/<str:artwork_id>', views.admin_artworks),
    path('api/uploads/<str:filename>', views.media), path('api/admin/uploads/<str:filename>', views.media),
    re_path(r'^api/(?:auth|users|visits)(?:/.*)?$', views.unavailable),
    re_path(r'^api/artworks/(?P<artwork_id>[^/]+)/(?:ask|explanation)$', views.unavailable_artwork),
    re_path(r'^api/admin/.*$', views.unavailable),
]
