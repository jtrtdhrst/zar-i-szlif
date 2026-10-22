FROM nginx:1.27-alpine
COPY app/website/index.html /usr/share/nginx/html/index.html
COPY app/website/assets/ /usr/share/nginx/html/assets/
COPY app/website/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
