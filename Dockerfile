##### BUILD #####
## Build the react application
FROM node:alpine

WORKDIR /app

COPY package.json .
RUN yarn install 

COPY . .
RUN yarn run build

##### SERVE #####
## Start Nginx and serve the result of the previous build process
FROM nginx

RUN rm -rf /etc/nginx/conf.d/*
COPY nginx/conf.d/* /etc/nginx/conf.d/

ENV PORT 80
EXPOSE 80
RUN rm -rf /usr/share/nginx/html
COPY --from=0 app/dist /usr/share/nginx/html
RUN ls -la /usr/share/nginx/html