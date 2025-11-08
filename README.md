# Recipe Scanner

## Background

I am a passionate home cook and collected many cooking books over the years.
However, I find myself rarely using them now and would like to find an easy way of digitizing them.

This project is done as part of a hackathon organized with a couple of friends.
We set ourselves the following boundary conditions:

- No Traditional Servers
- No Self-Managed Clusters
- Embrace Managed Servicess
- Infrastructure as Code is Mandatory
- Zero Idle Cost

## Technology

After gaining lots of experience with developing services on SAP's Business Technology Platform (BTP), I was interested in getting to know other Hyperscalers.
For this project I have decided to use AWS services and their Cloud Development Kit (CDK) to manage resources as code.
I will stick with JavaScript as my main programming langauge out of familiarity and ease of use.

## Data Format

I will use the [Recipe schema of schema.org](https://schema.org/Recipe), which is also the basis for [Google's structured recipe format](https://developers.google.com/search/docs/appearance/structured-data/recipe).
I also considered creating my own YAML or JSON format, however I feel that sticking to a common established schema is the better option.
I might use only a subset of available fields to increase accuracy and consistency of LLM output.

## Future Possibilities

After digitizing some recipes, I imagine the following use cases that could be built on top of a personal digital collection:

1. Recipe browser (incl. tagging and search)
1. Automatic meal planning (e.g. getting suggestions for a whole week and condensed shopping)
1. Reverse search (i.e. leftover recipe matcher)
