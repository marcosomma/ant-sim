# BabylonJs Boilerplate

## DEVELOPMENT

### YARN

`yarn dev`

### DOCKER

`docker-compose up`

To force build:

`docker-compose up --build --remove-orphans`

Then go to [0.0.0.0:8080](http://0.0.0.0:8080/)

## PRODUCTION

### YARN

`yarn build`

`yarn start`

### DOCKER

`docker build . --tag <project-name>:latest`

`docker run -it -p 80:80 <project-name>:latest`
